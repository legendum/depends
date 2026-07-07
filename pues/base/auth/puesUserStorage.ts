/**
 * `puesUserStorage(getDb)` — default `UserStorage` adapter for the
 * canonical pues schema. Built into the framework so consumers do not
 * have to write the same 7-fn boilerplate each time they adopt
 * `base/auth/`.
 *
 * Canonical `users` table (see SPEC §3.X):
 *
 *   id              INTEGER PRIMARY KEY
 *   email           TEXT NOT NULL UNIQUE
 *   legendum_token  TEXT
 *   meta            TEXT (JSON-encoded object)
 *
 * `getDb` is the consumer's bun:sqlite getter — called on each query so
 * lazy / cached / test-swappable `getDb` implementations all work.
 *
 * Wired automatically by `configureAuth({ getDb, … })` when no custom
 * `storage` is supplied — see `startup.ts`. Consumers with a non-
 * canonical schema (renamed table or columns) pass their own
 * `UserStorage` to `configureAuth({ storage, … })` instead. No options
 * struct here; convention kills config until a real consumer needs the
 * escape hatch.
 */

import type { Database } from "bun:sqlite";
import type { UserRow, UserStorage } from "./storage";

type StoredRow = {
  id: number;
  email: string;
  legendum_token: string | null;
};

function parseMeta(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
}

export function puesUserStorage(getDb: () => Database): UserStorage {
  return {
    findUserByEmail(email: string): UserRow | null {
      const row = getDb()
        .query("SELECT id, email, legendum_token FROM users WHERE email = ?")
        .get(email) as StoredRow | undefined;
      return row ?? null;
    },

    findUserByLegendumToken(token: string): UserRow | null {
      const row = getDb()
        .query(
          "SELECT id, email, legendum_token FROM users WHERE legendum_token = ?",
        )
        .get(token) as StoredRow | undefined;
      return row ?? null;
    },

    getLegendumToken(userId: number): string | null {
      const row = getDb()
        .query("SELECT legendum_token FROM users WHERE id = ?")
        .get(userId) as { legendum_token: string | null } | undefined;
      return row?.legendum_token ?? null;
    },

    createUser({ email, legendumToken }): UserRow {
      const db = getDb();
      db.run("INSERT INTO users (email, legendum_token) VALUES (?, ?)", [
        email,
        legendumToken ?? null,
      ]);
      const row = db
        .query("SELECT id, email, legendum_token FROM users WHERE email = ?")
        .get(email) as StoredRow;
      return row;
    },

    updateLegendumToken(userId: number, token: string | null): void {
      getDb().run("UPDATE users SET legendum_token = ? WHERE id = ?", [
        token,
        userId,
      ]);
    },

    getMeta(userId: number): Record<string, unknown> {
      const row = getDb()
        .query("SELECT meta FROM users WHERE id = ?")
        .get(userId) as { meta: string | null } | undefined;
      return parseMeta(row?.meta);
    },

    updateMeta(userId: number, meta: Record<string, unknown>): void {
      getDb().run("UPDATE users SET meta = ? WHERE id = ?", [
        JSON.stringify(meta),
        userId,
      ]);
    },
  };
}
