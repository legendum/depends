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
 * Per-token running tab. We accumulate sub-credit amounts locally and only
 * ever POST integer credits to Legendum (whose /api/charge requires positive
 * integers). When `total` reaches a whole credit we charge `Math.floor(total)`
 * and carry the fractional remainder forward to the next write.
 */
interface Tab {
  total: number;
}

const tabs = new Map<string, Tab>();

function getTab(legendumToken: string): Tab {
  let t = tabs.get(legendumToken);
  if (!t) {
    t = { total: 0 };
    tabs.set(legendumToken, t);
  }
  return t;
}

/**
 * Charge for a state write (0.1 credits). Accumulated credits are flushed
 * to Legendum once the tab reaches FLUSH_THRESHOLD whole credits; the
 * fractional remainder stays on the local tab until the next call. Returns
 * a 402 Response on insufficient funds, null otherwise.
 */
export async function chargeStateWrite(
  legendumToken: string | null,
): Promise<Response | null> {
  if (!legendumToken) return null;

  const tab = getTab(legendumToken);
  tab.total += STATE_WRITE_COST;

  if (tab.total + 1e-9 < FLUSH_THRESHOLD) return null;
  const whole = Math.floor(tab.total + 1e-9);

  tab.total -= whole;
  try {
    await legendum.charge(legendumToken, whole, "depends usage");
    return null;
  } catch (err: any) {
    if (err.code === "insufficient_funds") {
      tabs.delete(legendumToken);
      return insufficientFundsResponse();
    }
    // Roll the failed amount back onto the tab so we don't lose credits.
    tab.total += whole;
    throw err;
  }
}

/**
 * Flush all open tabs (e.g. on graceful shutdown). Any sub-credit dust is
 * rounded to the nearest whole credit; amounts below 0.5 are dropped.
 */
export async function flushAllTabs(): Promise<void> {
  for (const [token, tab] of tabs) {
    const amount = Math.round(tab.total);
    tabs.delete(token);
    if (amount < 1) continue;
    try {
      await legendum.charge(token, amount, "depends usage");
    } catch {
      // best-effort on shutdown
    }
  }
}
