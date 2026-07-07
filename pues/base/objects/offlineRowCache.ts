/**
 * IndexedDB-backed snapshot of a pues resource's rows.
 *
 * Why this exists: PWA-installed apps want cold reloads to render
 * something useful before the live `useResource` fetch resolves. The
 * pattern is always the same — mirror `resource.rows` into IDB on every
 * change; read it back on next mount; provide a `findBy` for the detail
 * page's `useSlugRouting.resolveExternal`.
 *
 * Two surfaces:
 *  - `createOfflineRowCache({ dbName, metaKey, project? })` — returns a
 *    plain `{ write, read, findBy }` triple usable outside React (e.g.
 *    a background reconnect-reconcile that also writes to the cache).
 *  - {@link useOfflineRowCache} — React wrapper that calls `write`
 *    whenever `resource.rows` updates and surfaces the same accessors.
 *
 * Storage layout: one IDB database per app (`dbName`), one shared
 * `meta` object store keyed by `metaKey` — typically the resource name
 * (e.g. `"lists"`, `"items"`). Multiple resources can share a single
 * DB by picking distinct keys.
 */

import { useEffect, useMemo } from "react";
import type { Row, UseResourceResult } from "./useResource";

const META_STORE = "meta";

type MetaEntry<Cached> = {
  key: string;
  rows: Cached[];
  fetchedAt: number;
};

type OfflineRowCacheOptions<TExtra, Cached> = {
  /** IndexedDB database name. One per app, shared across resources. */
  dbName: string;
  /** Key inside the single `meta` store. Typically the resource name. */
  metaKey: string;
  /** Project each row into the persisted shape. Defaults to identity. */
  project?: (row: Row<TExtra>) => Cached;
};

export type OfflineRowCache<Cached> = {
  /** Write the current rows snapshot. Idempotent — overwrites the
   *  existing entry under `metaKey`. */
  write: (rows: Cached[]) => Promise<void>;
  /** Read the cached snapshot. `null` if nothing has been written. */
  read: () => Promise<Cached[] | null>;
  /** Find a single cached row by an arbitrary field. */
  findBy: <K extends keyof Cached>(
    field: K,
    value: Cached[K],
  ) => Promise<Cached | null>;
};

const dbHandles = new Map<string, Promise<IDBDatabase>>();

function openDb(dbName: string): Promise<IDBDatabase> {
  let p = dbHandles.get(dbName);
  if (p) return p;
  p = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
  });
  dbHandles.set(dbName, p);
  return p;
}

export function createOfflineRowCache<TExtra, Cached = Row<TExtra>>(
  options: OfflineRowCacheOptions<TExtra, Cached>,
): OfflineRowCache<Cached> {
  const { dbName, metaKey, project } = options;

  async function read(): Promise<Cached[] | null> {
    const db = await openDb(dbName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).get(metaKey);
      req.onsuccess = () => {
        const entry = req.result as MetaEntry<Cached> | undefined;
        resolve(entry?.rows ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function write(rows: Cached[]): Promise<void> {
    const db = await openDb(dbName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(META_STORE).put({
        key: metaKey,
        rows,
        fetchedAt: Date.now(),
      } as MetaEntry<Cached>);
    });
  }

  async function findBy<K extends keyof Cached>(
    field: K,
    value: Cached[K],
  ): Promise<Cached | null> {
    const rows = await read();
    return rows?.find((r) => r[field] === value) ?? null;
  }

  // `project` is referenced by `useOfflineRowCache` (below) when it
  // calls `write`. Keep it in scope by exposing it on the returned
  // object via a closure variable read in the hook.
  (write as unknown as { project?: typeof project }).project = project;

  return { write, read, findBy };
}

export type UseOfflineRowCacheOptions<TExtra, Cached> = OfflineRowCacheOptions<
  TExtra,
  Cached
> & {
  /** When false, the hook neither writes nor opens IDB. Useful for
   *  gating on auth so the cache only mirrors signed-in user data. */
  enabled?: boolean;
};

/**
 * React hook: mirror `resource.rows` into IDB whenever they update, and
 * expose the same `{ read, findBy }` accessors as
 * {@link createOfflineRowCache}. The cache also writes on initial
 * `resource.rows` (so cold reloads end up with a hot cache).
 *
 * Pass the returned `findBy` to `useSlugRouting.resolveExternal` to make
 * detail-page cold reloads work offline:
 *
 * ```ts
 * const cache = useOfflineRowCache(resource, { dbName: "my-app", metaKey: "lists" });
 * useSlugRouting({
 *   resource,
 *   resolveExternal: (slug) => cache.findBy("slug", slug),
 *   ...
 * });
 * ```
 */
export function useOfflineRowCache<TExtra, Cached = Row<TExtra>>(
  resource: UseResourceResult<TExtra>,
  options: UseOfflineRowCacheOptions<TExtra, Cached>,
): OfflineRowCache<Cached> {
  const { enabled = true, project } = options;
  // Memoize the cache so identity is stable across renders.
  const cache = useMemo(
    () =>
      createOfflineRowCache<TExtra, Cached>({
        dbName: options.dbName,
        metaKey: options.metaKey,
        project,
      }),
    [options.dbName, options.metaKey, project],
  );

  useEffect(() => {
    if (!enabled) return;
    if (resource.loading) return;
    // Don't overwrite the cache with an empty array — that would
    // clobber the previous snapshot during the transient empty-rows
    // window on cold reload. Once we have at least one row we trust
    // the live state.
    if (resource.rows.length === 0) return;
    const projected = project
      ? resource.rows.map(project)
      : (resource.rows as unknown as Cached[]);
    void cache.write(projected);
  }, [enabled, resource.loading, resource.rows, cache, project]);

  return cache;
}
