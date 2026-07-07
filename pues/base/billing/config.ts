import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRoot } from "../core/defaultRoot";
import type { BillingChargeSpec, BillingConfig, BillingTabSpec } from "./types";

const SYMBOLIC_NAME_RE = /^[a-z][a-z0-9_]*$/;
const DEFAULT_TOPUP_URL = "https://legendum.co.uk/account";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function ensurePositiveNumber(v: unknown, path: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[pues/billing] ${path} must be a positive number`);
  }
  return n;
}

function ensureName(name: string, path: string): void {
  if (!SYMBOLIC_NAME_RE.test(name)) {
    throw new Error(
      `[pues/billing] ${path} uses invalid key "${name}" (expected ${SYMBOLIC_NAME_RE.source})`,
    );
  }
}

function parseCharge(name: string, raw: unknown): BillingChargeSpec {
  if (!isRecord(raw)) {
    throw new Error(
      `[pues/billing] billing.charges.${name} must be a YAML map`,
    );
  }
  const amount = ensurePositiveNumber(
    raw.amount,
    `billing.charges.${name}.amount`,
  );
  const description = String(raw.description ?? "").trim();
  if (!description) {
    throw new Error(
      `[pues/billing] billing.charges.${name}.description must be a non-empty string`,
    );
  }
  return { amount, description };
}

function parseTab(name: string, raw: unknown): BillingTabSpec {
  if (!isRecord(raw)) {
    throw new Error(`[pues/billing] billing.tabs.${name} must be a YAML map`);
  }
  const description = String(raw.description ?? "").trim();
  if (!description) {
    throw new Error(
      `[pues/billing] billing.tabs.${name}.description must be a non-empty string`,
    );
  }
  const thresholdRaw = ensurePositiveNumber(
    raw.threshold,
    `billing.tabs.${name}.threshold`,
  );
  const threshold = Math.max(1, Math.floor(thresholdRaw));
  const defaultRaw = raw.default_amount;
  const default_amount =
    defaultRaw === undefined
      ? undefined
      : ensurePositiveNumber(defaultRaw, `billing.tabs.${name}.default_amount`);
  return { description, threshold, default_amount };
}

export function readBillingConfig(root?: string): BillingConfig {
  const r = root ?? defaultRoot();
  const path = join(r, "config/pues.yaml");
  if (!existsSync(path)) {
    throw new Error(`[pues/billing] config file not found: ${path}`);
  }
  const text = readFileSync(path, "utf8");
  const parsed = Bun.YAML.parse(text) as { billing?: unknown } | null;
  const billingRaw = parsed?.billing;
  if (billingRaw === undefined || billingRaw === null) {
    return { topup_url: DEFAULT_TOPUP_URL, charges: {}, tabs: {} };
  }
  if (!isRecord(billingRaw)) {
    throw new Error("[pues/billing] billing must be a YAML map");
  }

  const topup =
    typeof billingRaw.topup_url === "string" && billingRaw.topup_url.trim()
      ? billingRaw.topup_url.trim()
      : undefined;

  const chargesRaw = billingRaw.charges;
  if (chargesRaw !== undefined && !isRecord(chargesRaw)) {
    throw new Error("[pues/billing] billing.charges must be a YAML map");
  }
  const charges: Record<string, BillingChargeSpec> = {};
  if (isRecord(chargesRaw)) {
    for (const [name, value] of Object.entries(chargesRaw)) {
      ensureName(name, "billing.charges");
      charges[name] = parseCharge(name, value);
    }
  }

  const tabsRaw = billingRaw.tabs;
  if (tabsRaw !== undefined && !isRecord(tabsRaw)) {
    throw new Error("[pues/billing] billing.tabs must be a YAML map");
  }
  const tabs: Record<string, BillingTabSpec> = {};
  if (isRecord(tabsRaw)) {
    for (const [name, value] of Object.entries(tabsRaw)) {
      ensureName(name, "billing.tabs");
      tabs[name] = parseTab(name, value);
    }
  }

  return {
    topup_url: topup ?? DEFAULT_TOPUP_URL,
    charges,
    tabs,
  };
}

export function getChargeSpec(name: string, root?: string): BillingChargeSpec {
  const cfg = readBillingConfig(root);
  const spec = cfg.charges[name];
  if (!spec) {
    throw new Error(`[pues/billing] unknown billing charge: ${name}`);
  }
  return spec;
}

export function getTabSpec(name: string, root?: string): BillingTabSpec {
  const cfg = readBillingConfig(root);
  const spec = cfg.tabs[name];
  if (!spec) {
    throw new Error(`[pues/billing] unknown billing tab: ${name}`);
  }
  return spec;
}
