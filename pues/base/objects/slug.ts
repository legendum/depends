/**
 * Slug derivation for the `slug` role (SPEC §5.13).
 *
 * Pues derives slugs server-side from a configured source column (typically
 * `label`) and writes them to the consumer's `slug` column on every INSERT
 * and on any UPDATE that changes the source value. The consumer's table
 * must carry a `slug` column with a `UNIQUE (<owner>, slug)` index;
 * uniqueness is enforced by the DB and surfaces as a 409 from mountResource.
 *
 * Route collisions (a slug shadowing a server route) are not pues'
 * problem to enforce — server route precedence wins. Consumers that mount
 * single-segment routes (e.g. `/inbox`) should namespace them under a
 * prefix (e.g. `/api/inbox`) so slugs can't collide.
 */

/** Canonical label → slug conversion. Lower-case, spaces/underscores → `-`,
 * strip anything outside `[a-z0-9.-]`, collapse repeats, strip edge `-`. */
export function toSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
