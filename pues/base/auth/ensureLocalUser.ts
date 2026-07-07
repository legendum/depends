/**
 * `ensureLocalUser()` — find-or-create the single well-known user that
 * owns everything in self-hosted mode. Fires `onNewUser` exactly once
 * when the row is freshly created (and never on subsequent calls).
 *
 * Hosted-mode-only callers throw — there is no "local user" in hosted
 * mode; user identity comes from the OAuth callback / link-key flow.
 */

import { isByLegendum, LOCAL_USER_EMAIL } from "../core/mode";
import { getAuthConfig } from "./startup";
import { getUserStorage } from "./storage";

export async function ensureLocalUser(): Promise<number> {
  if (isByLegendum()) {
    throw new Error(
      "ensureLocalUser() is only valid in self-hosted mode (LEGENDUM_API_KEY unset).",
    );
  }
  const storage = getUserStorage();
  const existing = await storage.findUserByEmail(LOCAL_USER_EMAIL);
  if (existing) return existing.id;

  const created = await storage.createUser({ email: LOCAL_USER_EMAIL });
  const config = getAuthConfig();
  if (config.onNewUser) {
    await config.onNewUser(created.id);
  }
  return created.id;
}
