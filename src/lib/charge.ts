import { createTabs } from "pues/base/billing/server";
import { legendum } from "pues/base/vendor/legendum";

const STATE_WRITE_COST = 0.1;
const FLUSH_THRESHOLD = 2;

function insufficientFundsResponse(): Response {
  return Response.json(
    { error: "Insufficient credits. Buy more at legendum.co.uk/account" },
    { status: 402 },
  );
}

/**
 * Charge a fixed amount immediately. Used for one-off charges like node
 * creation. Returns 402 on insufficient funds, null on success or when no
 * token is set (self-hosted mode).
 */
export async function chargeCredits(
  legendumToken: string | null,
  amount: number,
  description: string,
): Promise<Response | null> {
  if (!legendumToken) return null;
  try {
    await legendum.charge(legendumToken, amount, description);
    return null;
  } catch (err: any) {
    if (err.code === "insufficient_funds") return insufficientFundsResponse();
    throw err;
  }
}

/**
 * Best-effort charge that swallows all errors. Used for notification
 * dispatches where we don't want a failed charge to block the notification.
 */
export async function chargeBestEffort(
  legendumToken: string | null,
  amount: number,
  description: string,
): Promise<void> {
  if (!legendumToken) return;
  try {
    await legendum.charge(legendumToken, amount, description);
  } catch {
    // best-effort — don't block on charge failure
  }
}

/**
 * Running usage tab (pues base/billing). Canonical keying (pues ≥0.50.0):
 * subject = the namespace id (stable), the token passed fresh on every add —
 * rotation rebinds instead of stranding a dead-token tab. Fractional adds
 * accumulate client-side; only floored whole credits POST to /api/charge.
 */
const tabs = createTabs({
  channels: {
    usage: {
      description: "depends.cc usage",
      threshold: FLUSH_THRESHOLD,
      defaultAmount: STATE_WRITE_COST,
    },
  },
});

/**
 * Charge for a state write (0.1 credits). Returns a 402 Response on
 * insufficient funds, null otherwise.
 */
export async function chargeStateWrite(
  nsId: number,
  legendumToken: string | null,
): Promise<Response | null> {
  if (!legendumToken) return null;
  const r = await tabs.add({
    channel: "usage",
    subject: nsId,
    accountToken: legendumToken,
  });
  if (r.ok) return null;
  if (r.issue.code === "insufficient_funds") return insufficientFundsResponse();
  throw r.issue.cause ?? new Error(r.issue.message);
}

/**
 * Flush all open tabs (e.g. on graceful shutdown). Sub-credit dust is
 * dropped — never rounded up.
 */
export async function flushAllTabs(): Promise<void> {
  await tabs.closeAll();
}
