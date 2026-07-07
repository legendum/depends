/**
 * `broadcastRow` — re-emit a row mutation that happened *outside*
 * `mountResource`'s routes, so `useResource` subscribers stay coherent
 * across mixed write surfaces.
 *
 * The canonical case is a webhook surface (e.g. `/w/:ulid/*`) that
 * writes a resource's table directly, bypassing pues' POST/PATCH/DELETE
 * handlers and their built-in broadcasts. Without a bridge, browser tabs
 * subscribed to that resource via `useResource` would silently go stale
 * on every webhook mutation. With this helper, the webhook handler reads
 * the canonical wire row from the DB (via `toWire`) and calls
 * `broadcastRow` so subscribers see the same event shape they would get
 * from a native pues mutation.
 *
 * Scope (deliberately narrow):
 *   - `broadcastRow` covers `.created` and `.updated` — the two events
 *     that carry a full row.
 *   - `broadcastDelete` covers `.deleted` — payload is just `{ id }` or
 *     `{ id, parent_id }`, so it takes ids rather than a wire row.
 *   - Neither covers `.reordered` (different payload shape).
 *
 * See SPEC §7.4.
 */

import type { Broadcast } from "./mountResource";
import type { WireRow } from "./wire";

export function broadcastRow<TExtra = Record<string, unknown>>(
  broadcast: Broadcast,
  userId: number,
  name: string,
  event: "created" | "updated",
  row: WireRow<TExtra>,
  opts?: { op_id?: string | null },
): void {
  broadcast(userId, `${name}.${event}`, row, opts);
}

/**
 * Re-emit a `.deleted` event from outside `mountResource`'s DELETE
 * handler. Mirrors the native handler's payload shape — `{ id }` for
 * top-level resources, `{ id, parent_id }` for parent-scoped — so
 * `useResource` subscribers cannot tell the difference between a
 * native delete and a bridged one.
 *
 * Pass `parent_id` only for parent-scoped resources; omit for
 * top-level.
 */
export function broadcastDelete(
  broadcast: Broadcast,
  userId: number,
  name: string,
  id: string | number,
  opts?: { parent_id?: string | number; op_id?: string | null },
): void {
  const payload =
    opts?.parent_id !== undefined ? { id, parent_id: opts.parent_id } : { id };
  broadcast(userId, `${name}.deleted`, payload, { op_id: opts?.op_id ?? null });
}
