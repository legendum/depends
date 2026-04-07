const legendum = require("./legendum.js");

const STATE_WRITE_COST = 0.1;
const FLUSH_THRESHOLD = 2.0;

interface Tab {
  add(amount?: number): Promise<void>;
  close(): Promise<void>;
  readonly total: number;
}

const tabs = new Map<string, Tab>();

function getTab(legendumToken: string): Tab {
  let t = tabs.get(legendumToken);
  if (!t) {
    t = legendum.tab(legendumToken, "depends usage", {
      threshold: FLUSH_THRESHOLD,
      amount: STATE_WRITE_COST,
    }) as Tab;
    tabs.set(legendumToken, t);
  }
  return t;
}

/**
 * Charge for a state write (0.1 credits, flushed in batches of 2.0).
 * Returns a 402 Response on insufficient funds, null otherwise.
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
      return Response.json(
        { error: "Insufficient credits. Buy more at legendum.co.uk/account" },
        { status: 402 },
      );
    }
    throw err;
  }
}

/**
 * Flush all open tabs (e.g. on graceful shutdown).
 */
export async function flushAllTabs(): Promise<void> {
  for (const [token, t] of tabs) {
    try {
      await t.close();
    } catch {
      // best-effort
    }
    tabs.delete(token);
  }
}
