# Objects — `pues/base/objects`

The CRUD resource kit. One `config/pues.yaml` entry per resource becomes a full
set of owner-scoped REST routes over your SQLite table — no per-resource handler
code — plus a matching React front end (live list, reorder, rename, filter,
offline cache). Two barrels: `pues/base/objects` (client + server, pulls React)
and `pues/base/objects/server` (the CRUD machinery only, React-free — use it
from a pure API server).

## Provides
**Server** (`pues/base/objects/server`):
- `mountResource(args)` → a Bun `RouteMap` for one resource (see Routes)
- `loadPuesConfig(path?)`, `resolveColumns(db, name, cfg, parentCols?)` — read
  the config and resolve the role→column mapping (`ResolvedColumns`)
- `broadcastRow`, `broadcastDelete` — emit mutation events (wire to `base/sse`)
- position math: `appendPosition`, `computeRelativePosition`, `prependPosition`,
  `POSITION_STEP`; `toSlug`; `newId` (ULID); `toWire`
- hook + arg types: `MountResourceArgs`, `BeforeInsert/Update/DeleteHook`,
  `AuthConfig`, `ResolveUserFn`, `Broadcast`, `RouteMap`

**Client** (`pues/base/objects`, adds all the above plus):
- data hooks: `useResource` (SSE-live list + optimistic CRUD), `useCounts`,
  `useDelete`, `useRename`, `useFilter`/`useFilterQuery`/`useFilterEnter`,
  `useSlugRouting`, `useDndPositions`, `useOfflineRowCache`
- interaction hooks: `useListKeyboardNav`, `useFocusFilter`, `useEscape`,
  `useLongPress`, `useSwipeToReveal`, `useLogoButton`

## Components
Client (`pues/base/objects`) — the resource UI kit (each with a `*Props` type):
- `ObjectList` / `ObjectDetail` — the list and detail views
- `TopBar`, `FilterBar`, `FilterChips`, `TabStrip` — chrome, filtering, tabs
- `AddButton`, `RenameTitle`, `Dialog`, `CountsPill`, `DragHandle`, `LogoButton`
  — the supporting controls

## Config
`config/pues.yaml` under `objects.resources.<name>`:
- `table` (required) — the SQLite table
- `columns` — role→column overrides. Roles + defaults: `pk`=`id`,
  `public_id`=`ulid`, `owner`=`user_id`, `label`=`name`, `position`=`position`,
  `updated_at`, `created_at`, `meta`. Required roles: pk, public_id, owner,
  position. Optional roles can be opted out with `null`. Unmapped columns become
  **passthroughs** (verbatim on the wire); a column colliding with a canonical
  wire key must be mapped or renamed.
- `parent: { column, table }` + `prefix` — parent-scoped resource; the prefix
  template carries exactly one `:segment` capturing the parent's `public_id`.
  Ownership is inherited via the parent (don't map `owner`).
- `filter: { equals?, contains? }` — whitelist columns filterable via URL query
  (`?col=v`); `equals` is exact, `contains` is substring. Also gates `counts`.
- `methods` — subset of `GET POST PATCH DELETE` to mount (default all four;
  omitted methods 404, not 403)
- `slug: { from, column? }` — derive a URL-safe slug from a wire key on
  insert/rename (needs the column + a `UNIQUE(owner, slug)` index; conflicts →
  409)
- `timestamp_format` — `unix` (default) or `iso`

No env of its own.

## Routes / mounts / interfaces
Per resource `mountResource` returns (top-level shape; parent-scoped mounts
under `prefix`):
- `GET /api/<name>` — list (owner-scoped, ordered by position), paginated via
  `?limit`/`?offset`/`?after_position`, filtered via whitelisted query params
- `POST /api/<name>` — create (mints the `public_id`, appends position) → 201
- `PATCH /api/<name>/:id` — update fields and/or reorder (`before`/`after`/
  `position` in the body)
- `DELETE /api/<name>/:id` — delete → 204
- `GET /api/<name>/counts?by=<col>` — grouped counts across the user's set

**Wire shape** (`toWire`): canonical keys regardless of column names — `id`
(=public_id), `label`, `position`, `meta`, `slug`, `parent_id` (parent-scoped),
plus passthroughs. **Mutation events** (via `broadcast`, carrying `op_id` from
the request's `X-Op-Id` header): `<name>.created`, `<name>.updated` (full row),
`<name>.reordered` (`{id, position}`), `<name>.deleted` (`{id}`) — the SSE feed
`useResource` consumes. **Hooks** (`beforeInsert`/`beforeUpdate`/`beforeDelete`)
let you rewrite the effective body, enforce invariants, or return a `Response`
verbatim (402/403/409); a `throw` becomes a 400.

## Consume it
```ts
// server
import { mountResource, loadPuesConfig } from "pues/base/objects/server";
const cfg = await loadPuesConfig();
const routes = {
  ...mountResource({ db, name: "fifos", config: cfg.objects!.resources!.fifos,
                     resolveUser, broadcast }),
};

// client
import { ObjectList, useResource } from "pues/base/objects";
const { rows, create, rename, remove, reorder } = useResource({ name: "fifos" });
```

## Notes
`db` may be a `Database` or a `() => Database` getter — use the getter so
handlers survive a `db.close()` across tests (Bun finalizes statements on
close). All SQL is composed from the resolved mapping and identifiers are
quote-validated, so one handler source serves every consumer's schema. Auth is
per-verb (`auth: { get, write }`, each `"user"` | `"public"`; parent-scoped is
always user-scoped). Auto-pulls `core`; pairs with `db`, `auth`, `sse`, `pwa`.
Full design: `docs/pues/SPEC.md` §5–§6.
