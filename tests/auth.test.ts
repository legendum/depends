import { describe, test, expect } from "bun:test";
import { generateToken, hashToken, verifyToken, verifyTokenOnly } from "../src/auth";
import { createTestDb } from "../src/db";

describe("auth", () => {
  test("generates token with dep_ prefix", () => {
    const token = generateToken();
    expect(token.startsWith("dep_")).toBe(true);
    expect(token.length).toBeGreaterThan(10);
  });

  test("generates unique tokens", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });

  test("hashing is deterministic", async () => {
    const token = "dep_test123";
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);
    expect(h1).toBe(h2);
  });

  test("different tokens produce different hashes", async () => {
    const h1 = await hashToken("dep_aaa");
    const h2 = await hashToken("dep_bbb");
    expect(h1).not.toBe(h2);
  });

  test("verifyToken returns AuthResult for correct token + namespace", async () => {
    const db = createTestDb();
    const token = "dep_test123";
    const hash = await hashToken(token);
    const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash, plan) VALUES (?, 'free')").run(hash);
    db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run("myns", tokenId);

    const result = await verifyToken(db, "myns", token);
    expect(result).not.toBeNull();
    expect(result!.tokenId).toBe(Number(tokenId));
    expect(result!.plan).toBe("free");
    db.close();
  });

  test("verifyToken returns null for wrong token", async () => {
    const db = createTestDb();
    const hash = await hashToken("dep_correct");
    const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash) VALUES (?)").run(hash);
    db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run("myns", tokenId);

    expect(await verifyToken(db, "myns", "dep_wrong")).toBeNull();
    db.close();
  });

  test("verifyToken returns null for correct token but wrong namespace", async () => {
    const db = createTestDb();
    const hash = await hashToken("dep_correct2");
    const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash) VALUES (?)").run(hash);
    db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run("myns", tokenId);

    expect(await verifyToken(db, "other-ns", "dep_correct2")).toBeNull();
    db.close();
  });

  test("verifyToken returns null for non-existent namespace", async () => {
    const db = createTestDb();
    expect(await verifyToken(db, "nope", "dep_anything")).toBeNull();
    db.close();
  });

  test("verifyTokenOnly returns AuthResult without namespace check", async () => {
    const db = createTestDb();
    const token = "dep_only";
    const hash = await hashToken(token);
    const { lastInsertRowid: tokenId } = db.query("INSERT INTO tokens (token_hash, plan) VALUES (?, 'pro')").run(hash);

    const result = await verifyTokenOnly(db, token);
    expect(result).not.toBeNull();
    expect(result!.tokenId).toBe(Number(tokenId));
    expect(result!.plan).toBe("pro");
    db.close();
  });

  test("verifyTokenOnly returns null for bad token", async () => {
    const db = createTestDb();
    expect(await verifyTokenOnly(db, "dep_nope")).toBeNull();
    db.close();
  });
});
