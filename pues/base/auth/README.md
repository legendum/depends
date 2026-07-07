# `pues/base/auth/` — Legendum auth, vendored

Authentication for pues-consuming Legendum services. The part's consumer
contract lives in `docs/AUTH.md`; this README covers only the SDK sync
flow that's specific to this part.

## Where the SDK went (v0.45.0)

The vendored SDK files (`legendum.js`, `legendum.d.ts`, `legendum.md`)
moved to **`base/vendor/legendum/`** — the part that holds byte-identical
copies of externally-owned SDKs. Everything about provenance, the sync
flow, and the one-direction rule now lives there:

- Canonical source of truth: `../legendum/public/sdk/` (the legendum repo).
- Sync: `bun run vendor` (all vendored SDKs) · verify: `bun run
  scripts/vendor.ts --check`, enforced in smoke by
  `tests/vendor/drift.test.ts`. The old `bun run sync-sdk` is retired.
- Consumers still never sync from legendum directly — they re-vendor pues
  (`bun run pues`), and the SDK arrives via the `vendor` part
  (auto-pulled: `auth` depends on it).

The `.ts`/`.tsx` files in this directory are the pues auth surface
itself, authored here and committed normally. `mountLegendum()` adds a
pues-only `/pues/legendum/link-key` policy layer (TTL token reuse +
single-flight); the vendored SDK stays unchanged and exposes vanilla
`linkKey()` behavior when called directly.

## After a sync

1. Inspect the diff in `pues/base/vendor/legendum/`.
2. If the SDK API changed in a way that affects `mountLegendum.ts` or
   `Legendum.tsx`, update those.
3. Commit the synced files + any code changes together.
4. The next consumer-side `bun run pues` picks up the new SDK.
