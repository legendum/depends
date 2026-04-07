import { log } from "../lib/log";

export interface WebhookPayload {
  event: string;
  namespace: string;
  node_id: string;
  state: string;
  effective_state: string;
  previous_effective_state: string;
  reason: string | null;
  solution: string | null;
  triggered_rule: string;
  timestamp: string;
  ack_url?: string;
  title: string;
  body: string;
}

export async function computeSignature(
  body: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Buffer.from(sig).toString("hex");
}

export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  secret?: string | null,
  maxRetries: number = 3,
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret) {
    headers["X-Signature"] = await computeSignature(body, secret);
  }

  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      if (res.ok) return true;
      lastStatus = res.status;
      lastError = undefined;
    } catch (err) {
      lastStatus = undefined;
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < maxRetries - 1) {
      // Exponential backoff: 1s, 4s
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt * 2)));
    }
  }

  log({
    kind: "webhook_failed",
    url,
    namespace: payload.namespace,
    node_id: payload.node_id,
    triggered_rule: payload.triggered_rule,
    status: lastStatus,
    error: lastError,
  });

  return false;
}
