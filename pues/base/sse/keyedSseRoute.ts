/**
 * Server-Sent Events keyed by an arbitrary string — Flavor B (SPEC §7).
 *
 * Where `sseRoute` addresses streams by authenticated user, this addresses them
 * by a **key** the consumer chooses — typically a resource ULID ("everyone
 * watching logger `abc`"). It's the engine for public / resource channels:
 * loggers' live log tail, todos' shared-list stream.
 *
 * Because the key is arbitrary, the per-user "isolation by construction"
 * guarantee no longer applies, so access is an *explicit decision*: every
 * subscription runs `canSubscribe(key, req)` first. This is async on purpose —
 * the answer often needs a registry/DB lookup ("does this logger exist and is
 * it public?"). Returning false yields a 403; a non-existent key is the
 * consumer's own 404 to return *before* it calls `subscribe`.
 *
 * High-volume channels (a log firehose) configure `batch` per event name so the
 * core coalesces them into `{ items: [...] }` frames; low-volume channels leave
 * `batch` unset and every broadcast is immediate.
 *
 * `subscribe` is handed the already-extracted key rather than a route map: key
 * extraction (a `:ulid` path param) is the consumer's routing concern.
 */

import { type BatchPolicy, createStreamCore } from "./streamCore";

export type { BatchPolicy } from "./streamCore";

/** Authorise a subscription to `key`. Return false → 403. Async so it can hit a
 *  registry/DB (existence, visibility, ownership). */
export type CanSubscribe = (
  key: string,
  req: Request,
) => boolean | Promise<boolean>;

export type KeyedSseRouteArgs = {
  canSubscribe: CanSubscribe;
  heartbeatMs?: number;
  /** Per-key ring-buffer size for Last-Event-ID replay. Default 200; 0 disables
   *  replay (reconnect with a Last-Event-ID always gets `resync`). */
  ringMax?: number;
  /** Idle grace before a subscriber-less key's state is dropped. Default
   *  60_000ms. Matters for high-cardinality keyspaces (one key per resource) so
   *  quiet keys release their ring instead of pinning it for the process
   *  lifetime. */
  evictAfterMs?: number;
  /** Per-event coalescing — see `BatchPolicy`. Omit for all-immediate. */
  batch?: Record<string, BatchPolicy>;
};

export type KeyedSseRouteResult = {
  /** Open a stream for `key` after `canSubscribe` passes; 403 if it doesn't.
   *  Call this from your router with the key you extracted from the path. */
  subscribe: (req: Request, key: string) => Promise<Response>;
  /** Fan `data` out to everyone subscribed to `key`. Batched per the `batch`
   *  config, immediate otherwise.
   *
   *  Pass `{ op_id }` to fold the originating client's write id into the frame
   *  (object payloads get an `op_id` member; a scalar is wrapped as
   *  `{ value, op_id }`) — the same shaping `sseRoute` does. `useKeyedSSE`
   *  drops the frame whose op_id the receiving client minted, so it keeps its
   *  optimistic state instead of re-applying its own write. Omit `opts` (or
   *  leave `op_id` undefined) and the payload broadcasts untouched, so streams
   *  that don't do optimistic UI are unaffected. */
  broadcast: (
    key: string,
    event: string,
    data: unknown,
    opts?: { op_id?: string | null },
  ) => void;
  streamCount: () => number;
  /** Flush-cancel pending batch timers and drop state (tests / shutdown). */
  reset: () => void;
};

export function keyedSseRoute(args: KeyedSseRouteArgs): KeyedSseRouteResult {
  const core = createStreamCore({
    heartbeatMs: args.heartbeatMs,
    ringMax: args.ringMax,
    evictAfterMs: args.evictAfterMs,
    batch: args.batch,
  });

  const subscribe = async (req: Request, key: string): Promise<Response> => {
    const ok = await args.canSubscribe(key, req);
    if (!ok) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return core.attach(req, key);
  };

  const broadcast: KeyedSseRouteResult["broadcast"] = (
    key,
    event,
    data,
    opts,
  ) => {
    // No op_id requested → broadcast verbatim, so non-optimistic-UI streams
    // (a log firehose) keep their exact payload shape and batching.
    if (!opts || opts.op_id === undefined) {
      core.broadcast(key, event, data);
      return;
    }
    const payload =
      typeof data === "object" && data !== null
        ? { ...(data as object), op_id: opts.op_id ?? null }
        : { value: data, op_id: opts.op_id ?? null };
    core.broadcast(key, event, payload);
  };

  return {
    subscribe,
    broadcast,
    streamCount: core.streamCount,
    reset: core.reset,
  };
}
