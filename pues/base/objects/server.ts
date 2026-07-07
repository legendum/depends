/**
 * `base/objects/server` — the server-only surface of the objects part.
 *
 * The default barrel (`pues/base/objects`) mixes client components/hooks (React)
 * with the server CRUD machinery, so importing it from a Bun API server pulls
 * React into the runtime graph. A pure-API consumer (no PWA front end, or a
 * server entry that just mounts resources) imports from here instead and stays
 * React-free — the same client-safe-default / `/server` split `base/db` and
 * `base/auth` already use (SPEC §9.6).
 *
 * This re-exports ONLY from the part's non-React `.ts` files
 * (config / mountResource / wire / broadcast / position / slug / newId);
 * it must never re-export a `.tsx` component or a `use*` hook.
 */

export { broadcastDelete, broadcastRow } from "./broadcast";
export {
  type ColumnRoles,
  type HttpMethod,
  loadPuesConfig,
  type PuesConfig,
  type ResolvedColumns,
  type ResourceConfig,
  resolveColumns,
} from "./config";
export {
  type AuthConfig,
  type AuthPolicy,
  type BeforeDeleteContext,
  type BeforeDeleteHook,
  type BeforeInsertContext,
  type BeforeInsertHook,
  type BeforeUpdateContext,
  type BeforeUpdateHook,
  type Broadcast,
  type Handler,
  type MountResourceArgs,
  mountResource,
  type ResolveUserFn,
  type RouteMap,
} from "./mountResource";
export { newId } from "./newId";
export {
  appendPosition,
  computeRelativePosition,
  POSITION_STEP,
  prependPosition,
  type RenumberEntry,
  type ReorderResult,
  type Scope,
} from "./position";
export { toSlug } from "./slug";
export { toWire, type WireRow } from "./wire";
