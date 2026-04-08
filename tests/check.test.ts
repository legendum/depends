import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runChecks } from "../src/cli/commands/check";

const realFetch = globalThis.fetch;

type FetchCall = { url: string };
let calls: FetchCall[];

function mockFetch(responder: (url: string) => { status: number; body: string }) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url });
    const { status, body } = responder(url);
    return new Response(body, { status });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("runChecks", () => {
  test("single grep string passes when body contains it", async () => {
    mockFetch(() => ({ status: 200, body: "hello world" }));
    const result = await runChecks("node1", [
      { url: "https://example.com", grep: "hello" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(calls.length).toBe(1);
  });

  test("single grep string fails when body is missing it", async () => {
    mockFetch(() => ({ status: 200, body: "goodbye" }));
    const result = await runChecks("node1", [
      { url: "https://example.com", grep: "hello" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([`https://example.com missing "hello"`]);
  });

  test("array of greps reuses a single fetch", async () => {
    mockFetch(() => ({ status: 200, body: "alpha beta gamma" }));
    const result = await runChecks("node1", [
      {
        url: "https://example.com",
        grep: ["alpha", "beta", "gamma"],
      },
    ]);
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
  });

  test("array of greps reports each missing term", async () => {
    mockFetch(() => ({ status: 200, body: "alpha only" }));
    const result = await runChecks("node1", [
      { url: "https://example.com", grep: ["alpha", "beta", "gamma"] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      `https://example.com missing "beta"`,
      `https://example.com missing "gamma"`,
    ]);
    expect(calls.length).toBe(1);
  });

  test("duplicate URLs across separate checks fetch separately", async () => {
    mockFetch(() => ({ status: 200, body: "ok page" }));
    const result = await runChecks("node1", [
      { url: "https://example.com", grep: "ok" },
      { url: "https://example.com", grep: "page" },
    ]);
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(2);
  });

  test("non-2xx response is reported and grep is skipped", async () => {
    mockFetch(() => ({ status: 500, body: "" }));
    const result = await runChecks("node1", [
      { url: "https://example.com", grep: ["a", "b"] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([`https://example.com returned 500`]);
  });
});
