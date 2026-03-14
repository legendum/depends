import { describe, test, expect } from "bun:test";
import { generateToken, hashToken, verifyToken } from "../src/auth";
import { createTestDb } from "../src/db";

describe("auth", () => {
  test("generates token with dps_ prefix", () => {
    const token = generateToken();
    expect(token.startsWith("dps_")).toBe(true);
    expect(token.length).toBeGreaterThan(10);
  });

  test("generates unique tokens", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });

  test("hashing is deterministic", async () => {
    const token = "dps_test123";
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);
    expect(h1).toBe(h2);
  });

  test("different tokens produce different hashes", async () => {
    const h1 = await hashToken("dps_aaa");
    const h2 = await hashToken("dps_bbb");
    expect(h1).not.toBe(h2);
  });

  test("verifyToken returns true for correct token", async () => {
    const db = createTestDb();
    const token = "dps_test123";
    const hash = await hashToken(token);
    db.query("INSERT INTO namespaces (id, token_hash) VALUES (?, ?)").run(
      "myns",
      hash
    );

    expect(await verifyToken(db, "myns", token)).toBe(true);
    db.close();
  });

  test("verifyToken returns false for wrong token", async () => {
    const db = createTestDb();
    const hash = await hashToken("dps_correct");
    db.query("INSERT INTO namespaces (id, token_hash) VALUES (?, ?)").run(
      "myns",
      hash
    );

    expect(await verifyToken(db, "myns", "dps_wrong")).toBe(false);
    db.close();
  });

  test("verifyToken returns false for non-existent namespace", async () => {
    const db = createTestDb();
    expect(await verifyToken(db, "nope", "dps_anything")).toBe(false);
    db.close();
  });
});
