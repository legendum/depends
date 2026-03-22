# Migrating depends.cc from PayPal subscriptions to Legendum credits

## Current model

Monthly subscriptions via PayPal (not fully integrated — buttons only, no backend webhook):

| Plan       | Nodes | Events/month | Namespaces | Price     |
|-----------|-------|-------------|-----------|-----------|
| Free      | 10    | 100         | 1         | $0        |
| Pro       | 500   | 5,000       | 5         | $19/month |
| Team      | 2,000 | 20,000      | 20        | $49/month |

## New model

Pay-per-use via Legendum credits. No plans, no tiers, no subscriptions.

### What costs credits

| Action         | Cost  | Rationale                              |
|---------------|-------|----------------------------------------|
| State write   | Ⱡ 1   | Core operation, high volume            |
| Node create   | Ⱡ 5   | Prevents node spam                     |
| Webhook send  | Ⱡ 2   | Outbound HTTP has cost                 |
| Email send    | Ⱡ 2   | Email delivery costs more              |

### What's free

- All reads (graph queries, state checks, usage stats)
- Namespace creation
- Node deletion

### No limits

Remove plan-based limits entirely. If you have credits, you can use the service. No artificial caps on nodes, events, or namespaces.

The old limits existed to justify subscription tiers. With pay-per-use, the credits themselves are the limiting factor.

## Changes required

### Remove

- `views/pricing.eta` — PayPal buttons and pricing table
- `plan` column on `tokens` table (or keep as 'unlimited' for all)
- `PLAN_LIMITS` constant and all plan-limit checks in routes
- PayPal SDK script tag

### Add

- **Legendum SDK** (`src/legendum.js`, already copied)
- **Legendum service credentials** in env vars (`LEGENDUM_API_KEY`, `LEGENDUM_SECRET`)
- **Charge call on each billable action** via SDK:
  ```js
  await legendum.charge(accountToken, { amount: 1, description: "state write: ns/node" });
  ```
- **Link Legendum account to depends.cc token** — store `legendum_token` on `tokens` table
- **Login with Legendum** — replace email-only signup with OAuth login

### Database changes

```sql
ALTER TABLE tokens ADD COLUMN legendum_token TEXT;
```

This is the account_service token that Legendum returns when a user links their account to depends.cc. Used to charge credits.

### Modified files

| File | Change |
|------|--------|
| `src/db.ts` | Remove `PLAN_LIMITS`, remove plan check constraint, add `legendum_token` column |
| `src/routes/state.ts` | Replace plan limit check with `legendum.charge()` call |
| `src/routes/nodes.ts` | Replace plan limit check with `legendum.charge()` on node create |
| `src/notify/webhook.ts` | Add `legendum.charge()` after successful webhook delivery |
| `src/notify/email.ts` | Add `legendum.charge()` after successful email send |
| `src/routes/namespaces.ts` | Replace email signup with Login with Legendum OAuth |
| `views/pricing.eta` | Replace with simple pricing info (no PayPal buttons, link to legendum.co.uk) |
| `src/auth.ts` | Lookup `legendum_token` from token record for charge calls |

### Auth flow change

#### Browser users (Login with Legendum OAuth)

Current: `POST /v1/signup { email }` → token emailed → bearer token auth

New: Login with Legendum OAuth → depends.cc gets Legendum account link → generates depends.cc bearer token → user stores token

#### Agent users (CLI)

```
$ depends signup --legendum lak_a1b2c3d4e5f6...
```

1. CLI sends `lak_...` key to depends.cc
2. depends.cc calls `POST /api/agent/link-service` on Legendum with its service credentials + the agent's `lak_...` key
3. Legendum verifies the key, creates the account-service link, returns a `legendum_token`
4. depends.cc stores `legendum_token` against the user's `dep_...` token
5. CLI prints: `Linked to Legendum. Buy credits at legendum.co.uk/account`

**SDK usage in depends.cc backend:**

```js
const legendum = require("./legendum.js");
const client = legendum.service(LEGENDUM_API_KEY, LEGENDUM_SECRET);

// In the signup handler:
const { token } = await client.linkAccount(accountKey);
// Store token alongside dep_... token for charging
```

The depends.cc bearer token (`dep_...`) remains — it's the API auth mechanism. The Legendum token is stored alongside it for charging.

### Handling insufficient credits

When `legendum.charge()` returns insufficient balance:
- State writes → `402 Payment Required` with `{ "error": "insufficient credits", "url": "https://legendum.co.uk/account" }`
- Same behaviour as current plan limit exceeded, just a different reason

### Pricing page

Replace PayPal buttons with:
- Simple table of what costs credits
- Link to legendum.co.uk to buy credits
- Note: "depends.cc is powered by Ⱡ Credits"
