/**
 * Default public-id minter for object resources.
 *
 * Thin alias over the shared `core/ulid` primitive so there's one id
 * implementation across pues and consumers. Resources that need a different
 * id shape can still pass their own `newId` to `mountResource`.
 */

export { ulid as newId } from "../core/ulid";
