import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { errorHandler } from "./errors.js";
import { jsonSafe } from "./json.js";

const ALLOWED = "https://launchpad.example.com";
const app = createApp({ corsOrigins: [ALLOWED], ready: async () => true });

describe("api skeleton", () => {
  it("serves liveness", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("serves readiness when the database answers and 503 when it does not", async () => {
    expect((await app.request("/ready")).status).toBe(200);
    const down = createApp({ corsOrigins: [], ready: async () => false });
    expect((await down.request("/ready")).status).toBe(503);
    const throws = createApp({ corsOrigins: [], ready: async () => { throw new Error("connection refused"); } });
    expect((await throws.request("/ready")).status).toBe(503);
  });

  it("rejects an unknown chain slug with a machine-readable error", async () => {
    const res = await app.request("/mainnet/tokens");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_chain", message: expect.any(String) });
  });

  // The slug is a URL segment: names inherited from Object.prototype must not pass for a chain.
  it("treats 'constructor' and '__proto__' as unknown chains", async () => {
    for (const slug of ["constructor", "__proto__", "toString"]) {
      const res = await app.request(`/${slug}/tokens`);
      expect(res.status, slug).toBe(404);
      expect((await res.json()).error, slug).toBe("unknown_chain");
    }
  });

  it("answers an unmatched route on a known chain with the same JSON envelope", async () => {
    const res = await app.request("/sepolia/nothing-here");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: expect.any(String) });
  });
});

describe("cors", () => {
  const preflight = (origin: string) =>
    app.request("/health", { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET" } });

  it("allows a listed origin, with credentials", async () => {
    const res = await preflight(ALLOWED);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not echo an origin that is not on the list", async () => {
    const res = await preflight("https://evil.example.com");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never answers with a wildcard, since cookies are in play", async () => {
    for (const origin of [ALLOWED, "https://evil.example.com"]) {
      expect((await preflight(origin)).headers.get("access-control-allow-origin")).not.toBe("*");
    }
  });

  it("allows nobody when the list is empty", async () => {
    const closed = createApp({ corsOrigins: [], ready: async () => true });
    const res = await closed.request("/health", { method: "OPTIONS", headers: { origin: ALLOWED, "access-control-request-method": "GET" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("errorHandler", () => {
  it("returns a generic 500 and does not leak the error message or stack, but still logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new Hono();
    t.onError(errorHandler);
    t.get("/x", () => {
      throw new Error("password=hunter2 at /Users/long/secrets.ts");
    });
    const res = await t.request("/x");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("/Users/long");
    expect(JSON.parse(body)).toEqual({ error: "internal", message: expect.any(String) });
    // Hidden from the client, not swallowed: the operator still has to be able to see it.
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});

describe("jsonSafe", () => {
  it("serialises bigint as a string, because JSON cannot carry it", () => {
    expect(jsonSafe({ v: 10n ** 27n })).toEqual({ v: "1000000000000000000000000000" });
    expect(jsonSafe([{ nested: { deep: 1n } }])).toEqual([{ nested: { deep: "1" } }]);
  });

  it("leaves everything else alone", () => {
    expect(jsonSafe({ a: 1, b: "x", c: null, d: [true] })).toEqual({ a: 1, b: "x", c: null, d: [true] });
  });
});
