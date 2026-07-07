/**
 * Client subscription to a keyed / public SSE stream — the client half of
 * `keyedSseRoute` (Flavor B). Where `useSSE` subscribes to the per-user
 * `/api/events` stream (authenticated), this subscribes to a public
 * per-resource stream addressed by a path the caller builds from a key — a list
 * ULID, a logger ULID: `/list/${ulid}/events`.
 *
 * It owns the wire contract so consumers stop hand-rolling raw `EventSource`:
 *  - every frame's `data:` is JSON (the server stream core `JSON.stringify`s
 *    payloads), so each handler receives the already-parsed value;
 *  - the server may emit a synthetic `resync` event on reconnect (a replay-ring
 *    miss, or `ringMax: 0` which always resyncs) — this calls `onResync` so the
 *    client can rebuild state from REST, per `docs/SSE.md`.
 *  - op_id echo-suppression, the same as `useSSE` (SPEC §7.2): mint an id with
 *    `newOpId()`, send it to the server (a header / field of your choosing), and
 *    have your mutation handler pass it through to `keyedSseRoute.broadcast`'s
 *    `{ op_id }`. The server echoes it on the frame; this hook drops the frame
 *    whose op_id it minted, so a client keeps its optimistic state instead of
 *    re-applying its own write (which would race a later edit into a flicker).
 *    Frames with no op_id (foreign writes, server-initiated changes) apply
 *    normally, and `op_id` is handed to the handler as the second arg.
 *
 * Public by default: no credentials are sent (the key in the path is the
 * capability). Pass `withCredentials` for a same-origin authenticated keyed
 * stream. Pass `path: null` (or `enabled: false`) to stay disconnected — handy
 * for an offline-gated subscription.
 */

import { useEffect, useMemo, useRef } from "react";

import { ulid } from "../core/ulid";

export type KeyedSseHandler = (
  data: unknown,
  opts: { op_id: string | null },
) => void;

export type UseKeyedSSEOptions = {
  /** Default true. False (or `path: null`) keeps the stream closed. */
  enabled?: boolean;
  /** Send cookies on the EventSource. Default false — public streams don't
   *  need them; the key in the path is the credential. */
  withCredentials?: boolean;
  /** Called when the server emits `resync` (reconnect missed data) — rebuild
   *  from REST. */
  onResync?: () => void;
};

export type UseKeyedSSEResult = {
  /** Mint a new op_id and remember it; the matching server echo is dropped. */
  newOpId: () => string;
  /** Allow a server event with this op_id to be applied (used by callers that
   *  wish to clear an op_id ahead of receiving an echo). */
  forgetOpId: (opId: string) => void;
};

export function useKeyedSSE(
  path: string | null,
  handlers: Record<string, KeyedSseHandler>,
  options: UseKeyedSSEOptions = {},
): UseKeyedSSEResult {
  const { enabled = true, withCredentials = false, onResync } = options;

  // Op-ids minted by this client. Server echoes carrying any of these are
  // dropped; foreign events (op_id null or unknown) are applied.
  const ownOpIds = useRef<Set<string>>(new Set());

  // Refs so a changed handler/onResync closure is picked up without tearing
  // down the stream (the effect only re-runs on path/enabled/credentials).
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;

  useEffect(() => {
    if (!enabled || path == null) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined")
      return;

    const es = new EventSource(path, { withCredentials });

    const dispatch = (name: string) => (ev: MessageEvent<string>) => {
      const handler = handlersRef.current[name];
      if (!handler) return;
      let data: unknown;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      const opId =
        data && typeof data === "object" && "op_id" in (data as object)
          ? ((data as { op_id?: string | null }).op_id ?? null)
          : null;
      if (opId != null && ownOpIds.current.has(opId)) {
        ownOpIds.current.delete(opId);
        return;
      }
      handler(data, { op_id: opId });
    };

    const listeners: Array<[string, EventListener]> = [];
    for (const name of Object.keys(handlersRef.current)) {
      const listener = dispatch(name) as EventListener;
      es.addEventListener(name, listener);
      listeners.push([name, listener]);
    }

    const onResyncEvent = () => onResyncRef.current?.();
    es.addEventListener("resync", onResyncEvent);

    return () => {
      for (const [name, listener] of listeners) {
        es.removeEventListener(name, listener);
      }
      es.removeEventListener("resync", onResyncEvent);
      es.close();
    };
  }, [path, enabled, withCredentials]);

  return useMemo(
    () => ({
      newOpId: () => {
        const id = ulid();
        ownOpIds.current.add(id);
        return id;
      },
      forgetOpId: (opId: string) => {
        ownOpIds.current.delete(opId);
      },
    }),
    [],
  );
}
