const legendum = require("./legendum.js");

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
 * Per-token running tab backed by the Legendum SDK. The SDK accepts
 * fractional add() amounts, accumulates them client-side, and only POSTs
 * floored whole credits to /api/charge.
 */
const tabs = new Map<string, ReturnType<typeof legendum.tab>>();

function getTab(legendumToken: string) {
  let t = tabs.get(legendumToken);
  if (!t) {
    t = legendum.tab(legendumToken, "depends.cc usage", {
      threshold: FLUSH_THRESHOLD,
      amount: STATE_WRITE_COST,
    });
    tabs.set(legendumToken, t);
  }
  return t;
}

/**
 * Charge for a state write (0.1 credits). Returns a 402 Response on
 * insufficient funds, null otherwise.
 */
export async function chargeStateWrite(
  legendumToken: string | null,
): Promise<Response | null> {
  if (!legendumToken) return null;
  try {
    await getTab(legendumToken).add();
    return null;
  } catch (err: any) {
    if (err.code === "insufficient_funds") {
      tabs.delete(legendumToken);
      return insufficientFundsResponse();
    }
    throw err;
  }
}

/**
 * Flush all open tabs (e.g. on graceful shutdown). Sub-credit dust is
 * dropped — never rounded up.
 */
export async function flushAllTabs(): Promise<void> {
  for (const [token, tab] of tabs) {
    tabs.delete(token);
    try {
      await tab.close();
    } catch {
      // best-effort on shutdown
    }
  }
}
