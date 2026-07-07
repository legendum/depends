import legendum from "../vendor/legendum/legendum.js";
import { getChargeSpec } from "./config";
import type {
  BillingCode,
  BillingIssue,
  BillingReservation,
  BillingResult,
} from "./types";

function issueFromError(err: unknown): BillingIssue {
  const e = err as { code?: unknown; status?: unknown; message?: unknown };
  const rawCode = typeof e.code === "string" ? e.code : undefined;
  const message =
    typeof e.message === "string" && e.message.trim().length > 0
      ? e.message
      : "Billing unavailable";
  const status = typeof e.status === "number" ? e.status : undefined;

  const known: Record<
    string,
    { code: BillingCode; status: number; retryable: boolean }
  > = {
    insufficient_funds: {
      code: "insufficient_funds",
      status: 402,
      retryable: false,
    },
    token_not_found: {
      code: "token_not_found",
      status: 404,
      retryable: false,
    },
    unauthorized: { code: "unauthorized", status: 401, retryable: false },
    rate_limited: { code: "rate_limited", status: 429, retryable: true },
  };

  if (rawCode && known[rawCode]) {
    const k = known[rawCode];
    return {
      code: k.code,
      status: status ?? k.status,
      message,
      retryable: k.retryable,
      cause: err,
    };
  }

  return {
    code: rawCode ? "unknown" : "billing_unavailable",
    status: status ?? 503,
    message,
    retryable: true,
    cause: err,
  };
}

export function isInsufficientFunds(
  r: BillingResult<unknown>,
): r is { ok: false; issue: BillingIssue & { code: "insufficient_funds" } } {
  return !r.ok && r.issue.code === "insufficient_funds";
}

export function isTokenInvalid(
  r: BillingResult<unknown>,
): r is { ok: false; issue: BillingIssue & { code: "token_not_found" } } {
  return !r.ok && r.issue.code === "token_not_found";
}

export function isBillingConfigured(): boolean {
  return legendum.isConfigured();
}

/** The verified account email Legendum attaches to successful charge/settle
 *  payloads (SDK guide §7: "treat that field as authoritative when present").
 *  Surfaced in results so consumers can keep their user row in sync without a
 *  second API call — email changes at Legendum don't invalidate the link, so
 *  billing responses are how a service hears about them between logins. */
function emailFrom(data: unknown): string | undefined {
  const email = (data as { email?: unknown } | null | undefined)?.email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

export async function chargeNow(args: {
  accountToken: string | null;
  amount: number;
  description: string;
}): Promise<BillingResult<{ charged: number; email?: string } | null>> {
  if (!args.accountToken) return { ok: true, value: null };
  try {
    const data = await legendum.charge(
      args.accountToken,
      args.amount,
      args.description,
    );
    const email = emailFrom(data);
    return {
      ok: true,
      value: { charged: args.amount, ...(email ? { email } : {}) },
    };
  } catch (err) {
    return { ok: false, issue: issueFromError(err) };
  }
}

export async function chargeNamed(args: {
  accountToken: string | null;
  name: string;
  root?: string;
}): Promise<BillingResult<{ charged: number } | null>> {
  const spec = getChargeSpec(args.name, args.root);
  return chargeNow({
    accountToken: args.accountToken,
    amount: spec.amount,
    description: spec.description,
  });
}

export async function reserveNow(args: {
  accountToken: string | null;
  amount: number;
  description: string;
}): Promise<BillingResult<BillingReservation | null>> {
  if (!args.accountToken) return { ok: true, value: null };
  try {
    const held = args.amount;
    const reservation = await legendum.reserve(
      args.accountToken,
      held,
      args.description,
    );
    const wrapped: BillingReservation = {
      held,
      settle: async (amount) => {
        try {
          const data = await reservation.settle(amount);
          const email = emailFrom(data);
          return {
            ok: true,
            value: { settled: amount, ...(email ? { email } : {}) },
          };
        } catch (err) {
          return { ok: false, issue: issueFromError(err) };
        }
      },
      release: async () => {
        try {
          await reservation.release();
        } catch {
          // best-effort release
        }
      },
    };
    return { ok: true, value: wrapped };
  } catch (err) {
    return { ok: false, issue: issueFromError(err) };
  }
}

export async function reserveNamed(args: {
  accountToken: string | null;
  name: string;
  root?: string;
}): Promise<BillingResult<BillingReservation | null>> {
  const spec = getChargeSpec(args.name, args.root);
  return reserveNow({
    accountToken: args.accountToken,
    amount: spec.amount,
    description: spec.description,
  });
}

export async function settleTotal(args: {
  reservation: BillingReservation | null;
  accountToken: string | null;
  total: number;
  description: string;
  bestEffortShortfall?: boolean;
}): Promise<
  BillingResult<{
    total: number;
    settled: number;
    shortfall: number;
    chargedShortfall: number;
    email?: string;
  }>
> {
  const total = Math.max(0, args.total);
  if (!args.accountToken || !args.reservation) {
    return {
      ok: true,
      value: { total, settled: 0, shortfall: total, chargedShortfall: 0 },
    };
  }

  // Carry the freshest verified email any Legendum response includes (see
  // emailFrom) — later calls win, so the value reflects the last debit.
  let email: string | undefined;

  const settleAmount = Math.min(total, args.reservation.held);
  let settled = 0;
  if (settleAmount > 0) {
    const settledResult = await args.reservation.settle(settleAmount);
    if (!settledResult.ok) return settledResult;
    settled = settledResult.value.settled;
    email = settledResult.value.email ?? email;
  }

  const shortfall = Math.max(0, total - settled);
  if (shortfall <= 0) {
    return {
      ok: true,
      value: {
        total,
        settled,
        shortfall: 0,
        chargedShortfall: 0,
        ...(email ? { email } : {}),
      },
    };
  }

  const shortfallResult = await chargeNow({
    accountToken: args.accountToken,
    amount: shortfall,
    description: args.description,
  });
  if (shortfallResult.ok) {
    email = shortfallResult.value?.email ?? email;
    return {
      ok: true,
      value: {
        total,
        settled,
        shortfall,
        chargedShortfall: shortfall,
        ...(email ? { email } : {}),
      },
    };
  }

  if (args.bestEffortShortfall === false) return shortfallResult;

  if (shortfallResult.issue.code === "insufficient_funds") {
    try {
      const bal = await legendum.balance(args.accountToken);
      const take = Math.min(Math.floor(bal.balance), shortfall);
      if (take > 0) {
        const partial = await chargeNow({
          accountToken: args.accountToken,
          amount: take,
          description: args.description,
        });
        if (partial.ok) {
          email = partial.value?.email ?? email;
          return {
            ok: true,
            value: {
              total,
              settled,
              shortfall,
              chargedShortfall: take,
              ...(email ? { email } : {}),
            },
          };
        }
      }
    } catch {
      // best-effort fallback
    }
    return {
      ok: true,
      value: {
        total,
        settled,
        shortfall,
        chargedShortfall: 0,
        ...(email ? { email } : {}),
      },
    };
  }

  return {
    ok: true,
    value: {
      total,
      settled,
      shortfall,
      chargedShortfall: 0,
      ...(email ? { email } : {}),
    },
  };
}

export { issueFromError };
