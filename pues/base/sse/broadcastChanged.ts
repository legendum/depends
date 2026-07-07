/**
 * `broadcastChanged` — the surface-invalidation companion to `broadcastRow`
 * (pues/base/objects). Where `broadcastRow` carries a full row for the resource
 * model, this emits a payload-light `<surface>.changed` signal whose only job is
 * to tell the client "this view is stale, refetch it". Use it for surfaces that
 * aren't flat CRUD rows — a computed diff, an interleaved timeline, denormalized
 * counts — where there's no row to patch, only a REST endpoint to re-pull.
 *
 * The payload is just `{ scope }`: an optional opaque value (typically a parent
 * entity's id) so a per-user stream carrying events for many entities can be
 * filtered client-side — see `useInvalidation` / `useLiveFetch`'s `scope`. Pass
 * no scope for an unscoped, always-bump signal.
 *
 * Deliberately NO op_id echo-suppression path: invalidation WANTS the acting
 * client to refetch too — it has no optimistic row patch to protect, so the
 * actor receives its own `<surface>.changed` and revalidates like everyone else.
 * (Contrast `broadcast(..., { op_id })`, whose echo-drop exists to protect an
 * optimistic write — SPEC §7.2.)
 */

import type { Broadcast } from "./sseRoute";

export function broadcastChanged(
  broadcast: Broadcast,
  userId: number,
  surface: string,
  scope?: string | number | null,
): void {
  broadcast(userId, `${surface}.changed`, { scope: scope ?? null });
}
