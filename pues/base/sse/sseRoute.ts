/**
 * Server-Sent Events with per-user fan-out — Flavor A, the default (SPEC §7).
 *
 * Two things come out of `sseRoute()`:
 *   1. A route map the consumer spreads into Bun.serve — typically
 *      `{ "/api/events": { GET } }`.
 *   2. A `broadcast(userId, event, data, { op_id })` function that mutation
 *      handlers call after a successful write. Broadcasts are scoped by
 *      `userId`; there is intentionally no global-broadcast helper, so it is
 *      impossible to ship one user's mutations to another user's stream.
 *
 * Anonymous visitors (resolveUser → null) get a 401: this flavor always implies
 * an authenticated stream, and that isolation is guaranteed *by construction* —
 * the only key it ever attaches under is the resolved user. Public-read
 * consumers still serve their `auth: { get: "public" }` data via REST; for live
 * updates over a public/keyed stream, reach for `keyedSseRoute` instead.
 *
 * The wire protocol (ring buffer, Last-Event-ID replay, heartbeat) lives in
 * `streamCore`; this flavor only adds the per-user auth gate and the op_id
 * payload shaping.
 */

import type { ResolveUserFn } from "../objects/mountResource";
import { createStreamCore } from "./streamCore";

export type Broadcast = (
  userId: number,
  event: string,
  data: unknown,
  opts?: { op_id?: string | null },
) => void;

export type SseRouteArgs = {
  resolveUser: ResolveUserFn;
  path?: string;
  heartbeatMs?: number;
  /** Per-user ring-buffer size. Defaults to 200 events. Set to 0 to
   * disable replay entirely (clients always get `resync` on reconnect
   * with a Last-Event-ID header). */
  ringMax?: number;
  /** Idle grace before a user's subscriber-less stream state is dropped.
   * Default 60_000ms. */
  evictAfterMs?: number;
};

export type SseRouteResult = {
  routes: Record<
    string,
    Record<string, (req: Request) => Response | Promise<Response>>
  >;
  broadcast: Broadcast;
  streamCount: () => number;
};

const DEFAULT_PATH = "/api/events";

export function sseRoute(args: SseRouteArgs): SseRouteResult {
  const path = args.path ?? DEFAULT_PATH;
  const core = createStreamCore({
    heartbeatMs: args.heartbeatMs,
    ringMax: args.ringMax,
    evictAfterMs: args.evictAfterMs,
  });

  const handler = async (req: Request): Promise<Response> => {
    const uid = await args.resolveUser(req);
    if (uid == null) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return core.attach(req, String(uid));
  };

  const broadcast: Broadcast = (userId, event, data, opts) => {
    const payload =
      typeof data === "object" && data !== null
        ? { ...(data as object), op_id: opts?.op_id ?? null }
        : { value: data, op_id: opts?.op_id ?? null };
    core.broadcast(String(userId), event, payload);
  };

  return {
    routes: { [path]: { GET: handler } },
    broadcast,
    streamCount: core.streamCount,
  };
}
