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
}

export async function computeSignature(
  body: string,
  secret: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  return Buffer.from(sig).toString("hex");
}

export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  secret?: string | null,
  maxRetries: number = 3
): Promise<boolean> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret) {
    headers["X-Depends-Signature"] = await computeSignature(body, secret);
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      if (res.ok) return true;
    } catch {
      // Network error, retry
    }

    if (attempt < maxRetries - 1) {
      // Exponential backoff: 1s, 4s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt * 2)));
    }
  }

  return false;
}
