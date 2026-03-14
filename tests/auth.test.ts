import { describe, test, expect } from "bun:test";
import { generateToken, generateTokenId, hashToken, verifyToken, verifyTokenOnly } from "../src/auth";
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

  test("generates unique token IDs", () => {
    const id1 = generateTokenId();
    const id2 = generateTokenId();
    expect(id1).not.toBe(id2);
    expect(id1.length).toBe(32);
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
    const tokenId = "tok_1";
    const hash = await hashToken(token);
    db.query("INSERT INTO tokens (id, token_hash, plan) VALUES (?, ?, 'free')").run(tokenId, hash);
    db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run("myns", tokenId);

    const result = await verifyToken(db, "myns", token);
    expect(result).not.toBeNull();
    expect(result!.tokenId).toBe(tokenId);
    expect(result!.plan).toBe("free");
    db.close();
  });

  test("verifyToken returns null for wrong token", async () => {
    const db = createTestDb();
    const tokenId = "tok_2";
    const hash = await hashToken("dep_correct");
    db.query("INSERT INTO tokens (id, token_hash) VALUES (?, ?)").run(tokenId, hash);
    db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run("myns", tokenId);

    expect(await verifyToken(db, "myns", "dep_wrong")).toBeNull();
    db.close();
  });

  test("verifyToken returns null for correct token but wrong namespace", async () => {
    const db = createTestDb();
    const tokenId = "tok_3";
    const hash = await hashToken("dep_correct");
    db.query("INSERT INTO tokens (id, token_hash) VALUES (?, ?)").run(tokenId, hash);
    db.query("INSERT INTO namespaces (id, token_id) VALUES (?, ?)").run("myns", tokenId);

    expect(await verifyToken(db, "other-ns", "dep_correct")).toBeNull();
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
    const tokenId = "tok_4";
    const hash = await hashToken(token);
    db.query("INSERT INTO tokens (id, token_hash, plan) VALUES (?, ?, 'pro')").run(tokenId, hash);

    const result = await verifyTokenOnly(db, token);
    expect(result).not.toBeNull();
    expect(result!.tokenId).toBe(tokenId);
    expect(result!.plan).toBe("pro");
    db.close();
  });

  test("verifyTokenOnly returns null for bad token", async () => {
    const db = createTestDb();
    expect(await verifyTokenOnly(db, "dep_nope")).toBeNull();
    db.close();
  });
});
