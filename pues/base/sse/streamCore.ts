/**
 * streamCore — the shared SSE protocol engine behind both flavors of fan-out:
 * `sseRoute` (per-user) and `keyedSseRoute` (keyed). It is addressed by an
 * opaque **string** key and owns the whole wire protocol (SPEC §7): the stream
 * registry, a per-key ring buffer, Last-Event-ID replay / `resync`, the
 * heartbeat, frame encoding, and optional per-event batching.
 *
 * This is the single source of truth that used to be hand-copied between
 * `sseRoute` and consumers' bespoke tail streams. The flavors are thin wrappers:
 * they decide *who may attach to a key* (their auth posture) and *how a payload
 * is shaped*; everything on the wire lives here.
 *
 * All per-key state — subscribers, replay ring, batch buffers, and the eviction
 * timer — lives on one `Channel` object held in a single `Map<key, Channel>`,
 * rather than three parallel maps. That keeps a key's lifecycle in one place: a
 * `Channel` with no subscribers schedules its own eviction after a grace window
 * (`evictAfterMs`) and removes itself, so a key that goes quiet doesn't pin its
 * ring forever (a high-cardinality keyed stream — one key per resource ULID —
 * would otherwise leak a buffer per key for the process lifetime). The grace is
 * what lets a brief reconnect still replay; only a genuinely idle key is dropped,
 * and a later reconnect to a dropped key safely falls back to `resync`.
 *
 * Server-only: every timer is `unref()`'d so the core never keeps the process
 * alive on its own.
 *
 * Internal to `base/sse` — consumers reach it only through a flavor.
 */

const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_RING_MAX = 200;
/** Drop a key's `Channel` this long after its last subscriber leaves. Long
 *  enough that an EventSource auto-reconnect (seconds) still replays from the
 *  ring; short enough that idle keys don't accumulate. */
const DEFAULT_EVICT_AFTER_MS = 60_000;

/** Coalescing policy for one event name. Matching broadcasts buffer and emit as
 *  a single `{ items: [...] }` frame instead of one frame each. */
export type BatchPolicy = {
  /** Flush a partial batch this many ms after the first buffered event. */
  windowMs: number;
  /** Flush eagerly once this many events have buffered (default: unbounded —
   *  only the window flushes). */
  maxEvents?: number;
};

export type StreamCoreArgs = {
  heartbeatMs?: number;
  /** Per-key ring size for Last-Event-ID replay. 0 disables replay (every
   *  reconnect with a Last-Event-ID gets `resync`). Default 200. */
  ringMax?: number;
  /** Idle grace before a subscriber-less key's `Channel` is evicted. Default
   *  60_000ms. Smaller frees memory sooner but forces `resync` on reconnects
   *  slower than the window. */
  evictAfterMs?: number;
  /** Per-event coalescing. An event named here batches; events not listed emit
   *  immediately (the default for everything). */
  batch?: Record<string, BatchPolicy>;
};

export type StreamCore = {
  /** Open a stream for `key`: connect comment, Last-Event-ID replay, heartbeat,
   *  and teardown on request abort. The caller is responsible for authorising
   *  the key *before* calling this. */
  attach: (req: Request, key: string) => Response;
  /** Fan `payload` out to `key`'s live streams (and the replay ring) as event
   *  `event`. Batched when `event` has a `BatchPolicy`, immediate otherwise.
   *  `payload` is the final JSON-serialisable frame body — flavors do their own
   *  op_id / shaping before calling this. */
  broadcast: (key: string, event: string, payload: unknown) => void;
  /** Number of live subscriber connections across all keys. */
  streamCount: () => number;
  /** Number of keys with live state (subscribers and/or a retained ring). */
  channelCount: () => number;
  /** Flush-cancel every pending timer and drop all state. For tests and
   *  graceful shutdown. */
  reset: () => void;
};

type StreamCtrl = { enqueue: (chunk: Uint8Array) => void };
type RingEntry = { id: number; frame: Uint8Array };
type Pending = {
  items: unknown[];
  timer: ReturnType<typeof setTimeout> | null;
};

type ReplayResult = { resync: true } | { resync: false; frames: Uint8Array[] };

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Detach a server timer from the event loop where the runtime supports it
 *  (Bun/Node). Typed loosely so the call is a no-op on a runtime whose timer
 *  handle has no `unref`. */
function unref(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

/**
 * Fixed-capacity circular buffer of ring entries — O(1) append with no array
 * reindexing (unlike push/shift), which matters on the firehose path. Entries
 * are appended in strictly increasing `id` order, so the buffer is ordered
 * oldest→newest and replay is a single pass.
 */
class Ring {
  readonly #buf: (RingEntry | undefined)[];
  #start = 0;
  #size = 0;

  constructor(private readonly capacity: number) {
    this.#buf = new Array(capacity);
  }

  push(entry: RingEntry): void {
    const idx = (this.#start + this.#size) % this.capacity;
    this.#buf[idx] = entry;
    if (this.#size < this.capacity) this.#size++;
    else this.#start = (this.#start + 1) % this.capacity; // overwrote oldest
  }

  get size(): number {
    return this.#size;
  }

  get oldestId(): number {
    return this.#size ? this.#buf[this.#start]!.id : 0;
  }

  get newestId(): number {
    return this.#size
      ? this.#buf[(this.#start + this.#size - 1) % this.capacity]!.id
      : 0;
  }

  framesAfter(afterId: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < this.#size; i++) {
      const entry = this.#buf[(this.#start + i) % this.capacity]!;
      if (entry.id > afterId) out.push(entry.frame);
    }
    return out;
  }
}

/**
 * All state for one key: live subscribers, the replay ring, per-event batch
 * buffers, and a self-eviction timer. Disposable (`using`-compatible): disposal
 * cancels every timer it owns. A subscriber-less channel schedules its own
 * eviction; gaining a subscriber cancels it.
 */
class Channel {
  readonly #subscribers = new Set<StreamCtrl>();
  readonly #ring: Ring | null;
  readonly #pending = new Map<string, Pending>();
  #evictTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    ringMax: number,
    private readonly evictAfterMs: number,
    private readonly onEvict: () => void,
  ) {
    this.#ring = ringMax > 0 ? new Ring(ringMax) : null;
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  addSubscriber(ctrl: StreamCtrl): void {
    this.#cancelEviction();
    this.#subscribers.add(ctrl);
  }

  removeSubscriber(ctrl: StreamCtrl): void {
    this.#subscribers.delete(ctrl);
    this.scheduleEvictionIfIdle();
  }

  /** Ring a frame and fan it out to live subscribers. */
  record(entry: RingEntry): void {
    this.#ring?.push(entry);
    for (const ctrl of this.#subscribers) {
      try {
        ctrl.enqueue(entry.frame);
      } catch {
        // controller closed under our feet — drop it silently
      }
    }
    this.scheduleEvictionIfIdle();
  }

  replay(afterId: number): ReplayResult {
    const ring = this.#ring;
    if (!ring || ring.size === 0) return { resync: true };
    const head = ring.newestId;
    const tail = ring.oldestId;
    if (afterId > head || afterId < tail - 1) return { resync: true };
    return { resync: false, frames: ring.framesAfter(afterId) };
  }

  /** Get-or-create the batch buffer for `event`. */
  pending(event: string): Pending {
    let p = this.#pending.get(event);
    if (!p) {
      p = { items: [], timer: null };
      this.#pending.set(event, p);
    }
    return p;
  }

  /** Clear `event`'s batch timer and take its buffered items, or null when
   *  there's nothing to flush. */
  takePending(event: string): unknown[] | null {
    const p = this.#pending.get(event);
    if (!p) return null;
    if (p.timer) {
      clearTimeout(p.timer);
      p.timer = null;
    }
    return p.items.length ? p.items.splice(0) : null;
  }

  /** Arm the eviction timer once the channel has no subscribers (idempotent —
   *  a no-op while subscribed or already armed). */
  scheduleEvictionIfIdle(): void {
    if (this.#subscribers.size > 0 || this.#evictTimer) return;
    this.#evictTimer = setTimeout(() => {
      this[Symbol.dispose]();
      this.onEvict();
    }, this.evictAfterMs);
    unref(this.#evictTimer);
  }

  #cancelEviction(): void {
    if (this.#evictTimer) {
      clearTimeout(this.#evictTimer);
      this.#evictTimer = null;
    }
  }

  [Symbol.dispose](): void {
    this.#cancelEviction();
    for (const p of this.#pending.values()) {
      if (p.timer) clearTimeout(p.timer);
    }
    this.#pending.clear();
  }
}

export function createStreamCore(args: StreamCoreArgs = {}): StreamCore {
  const heartbeatMs = args.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const ringMax = args.ringMax ?? DEFAULT_RING_MAX;
  const evictAfterMs = args.evictAfterMs ?? DEFAULT_EVICT_AFTER_MS;
  const batchPolicies = args.batch ?? {};
  const channels = new Map<string, Channel>();
  const encoder = new TextEncoder();
  let counter = 0;
  const nextId = (): number => ++counter;

  const channelFor = (key: string): Channel => {
    const existing = channels.get(key);
    if (existing) return existing;
    const ch = new Channel(ringMax, evictAfterMs, () => {
      // Guard against deleting a successor channel for the same key.
      if (channels.get(key) === ch) channels.delete(key);
    });
    channels.set(key, ch);
    return ch;
  };

  /** Encode one frame, ring it, and send it live. */
  const emit = (key: string, event: string, dataJson: string): void => {
    const id = nextId();
    const frame = encoder.encode(
      `event: ${event}\nid: ${id}\ndata: ${dataJson}\n\n`,
    );
    channelFor(key).record({ id, frame });
  };

  const flush = (key: string, event: string): void => {
    const ch = channels.get(key);
    if (!ch) return;
    const items = ch.takePending(event);
    if (!items) return;
    emit(key, event, JSON.stringify({ items }));
  };

  const broadcast = (key: string, event: string, payload: unknown): void => {
    const policy = batchPolicies[event];
    if (!policy) {
      emit(key, event, JSON.stringify(payload));
      return;
    }
    const ch = channelFor(key);
    const p = ch.pending(event);
    p.items.push(payload);
    if (policy.maxEvents != null && p.items.length >= policy.maxEvents) {
      flush(key, event);
      return;
    }
    if (!p.timer) {
      p.timer = setTimeout(() => flush(key, event), policy.windowMs);
      unref(p.timer);
    }
    ch.scheduleEvictionIfIdle();
  };

  const attach = (req: Request, key: string): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const ctrl: StreamCtrl = { enqueue: (c) => controller.enqueue(c) };
        const ch = channelFor(key);
        ch.addSubscriber(ctrl);

        // Initial comment so EventSource sees a successful connect.
        controller.enqueue(encoder.encode(`: connected\n\n`));

        // Last-Event-ID replay. Browsers send it as a header on reconnect; when
        // present and valid we replay strictly newer ring entries, or emit one
        // `resync` if the id is outside the ring (stale, evicted, or
        // pre-restart).
        const lastIdHeader = req.headers.get("Last-Event-ID");
        const parsed = lastIdHeader
          ? Number.parseInt(lastIdHeader, 10)
          : Number.NaN;
        if (Number.isFinite(parsed) && parsed > 0) {
          const result = ch.replay(parsed);
          if (result.resync) {
            const resyncId = nextId();
            controller.enqueue(
              encoder.encode(`event: resync\nid: ${resyncId}\ndata: {}\n\n`),
            );
          } else {
            for (const frame of result.frames) controller.enqueue(frame);
          }
        }

        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            clearInterval(heartbeat);
          }
        }, heartbeatMs);
        unref(heartbeat);

        const teardown = () => {
          clearInterval(heartbeat);
          ch.removeSubscriber(ctrl);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        req.signal.addEventListener("abort", teardown, { once: true });
      },
    });

    return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } });
  };

  const streamCount = (): number => {
    let n = 0;
    for (const ch of channels.values()) n += ch.subscriberCount;
    return n;
  };

  const channelCount = (): number => channels.size;

  const reset = (): void => {
    for (const ch of channels.values()) ch[Symbol.dispose]();
    channels.clear();
    counter = 0;
  };

  return { attach, broadcast, streamCount, channelCount, reset };
}
