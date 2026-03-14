import { describe, test, expect } from "bun:test";
import { computeSignature } from "../../src/notify/webhook";

describe("webhook", () => {
  test("HMAC signature is deterministic", async () => {
    const body = '{"test": true}';
    const secret = "whsec_test";
    const sig1 = await computeSignature(body, secret);
    const sig2 = await computeSignature(body, secret);
    expect(sig1).toBe(sig2);
  });

  test("different bodies produce different signatures", async () => {
    const secret = "whsec_test";
    const sig1 = await computeSignature('{"a": 1}', secret);
    const sig2 = await computeSignature('{"a": 2}', secret);
    expect(sig1).not.toBe(sig2);
  });

  test("different secrets produce different signatures", async () => {
    const body = '{"test": true}';
    const sig1 = await computeSignature(body, "secret1");
    const sig2 = await computeSignature(body, "secret2");
    expect(sig1).not.toBe(sig2);
  });

  test("signature is a hex string", async () => {
    const sig = await computeSignature("hello", "secret");
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(sig.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });
});
