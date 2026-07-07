/**
 * `resolveUser(req)` — the one-line helper consumers pass to
 * `mountResource({ resolveUser })` and `sseRoute({ resolveUser })`.
 *
 * Self-hosted: returns the single local user id (lazily created via
 * `ensureLocalUser` — also fires `onNewUser` on first call).
 * Hosted: delegates to `getAuthUserIdWithBearer` (cookie or bearer).
 *
 * Replaces the per-consumer `resolvePuesUser` wrapper. Each consumer's
 * `server.ts` now does `mountResource({ resolveUser, ... })` directly.
 */

import { isByLegendum } from "../core/mode";
import { ensureLocalUser } from "./ensureLocalUser";
import { getAuthUserIdWithBearer } from "./middleware";

export async function resolveUser(req: Request): Promise<number | null> {
  if (!isByLegendum()) {
    return await ensureLocalUser();
  }
  return await getAuthUserIdWithBearer(req);
}
