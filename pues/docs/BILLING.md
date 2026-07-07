# Billing — `pues/base/billing`

Charge users through the Legendum account SDK. Three modes: **one-shot**
charges, **reservations** (hold → settle/release), and **tabs** (accumulate
micro-charges, auto-flush at a threshold). Server-only — it reads
`config/pues.yaml` and talks to the SDK, so consumers import
`pues/base/billing/server`.

## Provides
From `pues/base/billing/server`:
- **charges**: `chargeNow` / `chargeNamed` (immediate), `reserveNow` /
  `reserveNamed` (hold, returns a `BillingReservation` with `settle`/`release`),
  `settleTotal` (settle a reservation against a final total, charging any
  shortfall best-effort)
- **tabs**: `createTabs` (inline channels) / `createTabsFromConfig` (channels
  from `billing.tabs.<name>`) — accumulate `add(amount)` calls, flush at
  `threshold`. **Canonical keying**: `subject` = the stable ledger identity
  (userId); `accountToken` = a credential read fresh from your DB on every
  `add`. Never key a tab cache by token — the token rotates on every re-link.
- **guards**: `isBillingConfigured()` (is the SDK wired?), `isInsufficientFunds`,
  `isTokenInvalid` (narrow a failed `BillingResult`)
- **config readers**: `readBillingConfig`, `getChargeSpec`, `getTabSpec`
- types: `BillingResult`, `BillingIssue`, `BillingCode`, `BillingReservation`,
  `BillingTab`, `BillingTabs`, `TabChannel`, `BillingConfig`,
  `BillingChargeSpec`, `BillingTabSpec`

Every operation returns `BillingResult<T>` — `{ ok: true, value }` or
`{ ok: false, issue }`. A **`null` account token is a success no-op** (billing
disabled / self-hosted): callers stay branch-free.

Successful charge/settle values carry **`email?`** — the verified account email
Legendum attaches to debit payloads (authoritative when present, per the SDK
guide: email changes at Legendum don't invalidate the link, so billing
responses are how you hear about them between logins). Use it to keep your
user row in sync; ignore it if you don't care.

## Config
`config/pues.yaml` under `billing:` (whole block optional). Charge/tab keys must
match `^[a-z][a-z0-9_]*$`; amounts must be positive.
- `topup_url` — where to send a user who's out of funds (default
  `https://legendum.co.uk/account`)
- `charges.<name>` — `{ amount, description }`; look up by name with
  `chargeNamed` / `reserveNamed`
- `tabs.<name>` — `{ description, threshold, default_amount? }`; `threshold`
  floored to ≥1. Drive with `createTabsFromConfig`

No env of its own; the SDK reads its own credentials (see `vendor` / Legendum).

## Routes / mounts / interfaces
No routes. The interface is the **Legendum account SDK** (`charge`, `reserve`,
`tab`, `balance`) plus the **`BillingIssue` shape** you surface to your own
callers: SDK errors are normalized to a stable `code` + HTTP-ready `status`
(`insufficient_funds`→402, `token_not_found`→404, `unauthorized`→401,
`rate_limited`→429, unavailable→503) + `retryable`. Reflect `issue.status`
straight into your HTTP response.

## Consume it
```ts
import { chargeNamed, isInsufficientFunds } from "pues/base/billing/server";

const r = await chargeNamed({ accountToken, name: "export_pdf" });
if (!r.ok) {
  if (isInsufficientFunds(r)) return topUpPrompt();
  return new Response(r.issue.message, { status: r.issue.status });
}
```

## Notes
Auto-pulls `vendor` (the Legendum SDK). Reservations flow: `reserveNow` holds an
estimate, then `settleTotal` charges the real total — settling from the hold
first, then charging any shortfall (best-effort by default; set
`bestEffortShortfall: false` to fail hard). Tabs are best-effort on
flush/close (errors swallowed) but surface `token_not_found` from `add` so you
can re-link; `createTabs` manages one tab per `(subject, channel)` and cleans up
on `close`/`closeAll`. **Rotation-safe**: when `add` carries a different token
than the tab was built with (every re-link mints a fresh token and kills the
old one), `createTabs` closes the stale tab and rebinds to the current token —
so `token_not_found` only ever means the *current* token is dead, which is
exactly when severing the link (your `onTokenInvalid`) is right. Full design:
`docs/pues/SPEC.md` §9.
