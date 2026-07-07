export type BillingCode =
  | "insufficient_funds"
  | "token_not_found"
  | "unauthorized"
  | "rate_limited"
  | "billing_unavailable"
  | "unknown";

export type BillingIssue = {
  code: BillingCode;
  status: number;
  message: string;
  retryable: boolean;
  cause?: unknown;
};

export type BillingResult<T> =
  | { ok: true; value: T }
  | { ok: false; issue: BillingIssue };

export type BillingChargeSpec = {
  amount: number;
  description: string;
};

export type BillingTabSpec = {
  description: string;
  threshold: number;
  default_amount?: number;
};

export type BillingConfig = {
  topup_url?: string;
  charges: Record<string, BillingChargeSpec>;
  tabs: Record<string, BillingTabSpec>;
};

export type BillingReservation = {
  held: number;
  settle(
    amount: number,
  ): Promise<BillingResult<{ settled: number; email?: string }>>;
  release(): Promise<void>;
};

export type BillingTab = {
  add(amount?: number): Promise<BillingResult<null>>;
  flush(): Promise<void>;
  close(): Promise<void>;
};

export type TabChannel = {
  description: string;
  threshold: number;
  defaultAmount?: number;
};

export type BillingTabs = {
  add(args: {
    channel: string;
    subject: string | number;
    accountToken: string | null;
    amount?: number;
  }): Promise<BillingResult<null>>;
  flush(args?: { subject?: string | number; channel?: string }): Promise<void>;
  close(args?: { subject?: string | number; channel?: string }): Promise<void>;
  closeAll(): Promise<void>;
};
