import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getSql } from "../db.js";
import { consumeRateLimit, rateLimit } from "./rate-limit.js";

beforeEach(async () => {
  await getSql()`truncate app.rate_hit`;
});
afterAll(() => getSql().end());

describe("consumeRateLimit", () => {
  it("allows up to the limit and then refuses, saying how long to wait", async () => {
    for (let i = 0; i < 5; i++) expect((await consumeRateLimit("upload", "0xa", 5, 3600)).allowed).toBe(true);
    const sixth = await consumeRateLimit("upload", "0xa", 5, 3600);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(3500);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it("counts each person and each limit separately", async () => {
    for (let i = 0; i < 5; i++) await consumeRateLimit("upload", "0xa", 5, 3600);
    expect((await consumeRateLimit("upload", "0xb", 5, 3600)).allowed).toBe(true);
    expect((await consumeRateLimit("nonce", "0xa", 5, 3600)).allowed).toBe(true);
  });

  it("forgets hits older than the window", async () => {
    for (let i = 0; i < 5; i++) await consumeRateLimit("upload", "0xa", 5, 3600);
    await getSql()`update app.rate_hit set at = now() - interval '2 hours'`;
    expect((await consumeRateLimit("upload", "0xa", 5, 3600)).allowed).toBe(true);
  });

  it("does not count a refused request against the person", async () => {
    for (let i = 0; i < 3; i++) await consumeRateLimit("x", "k", 3, 60);
    for (let i = 0; i < 10; i++) await consumeRateLimit("x", "k", 3, 60);
    const [row] = await getSql()`select count(*)::int as n from app.rate_hit`;
    expect(row!.n).toBe(3);
  });

  it("holds when many requests arrive at once: never more than the limit get through", async () => {
    // Several bursts on different keys, so a race that only loses now and then still shows up.
    for (const key of ["a", "b", "c", "d", "e"]) {
      const results = await Promise.all(Array.from({ length: 40 }, () => consumeRateLimit("burst", key, 5, 60)));
      expect(results.filter((r) => r.allowed), `burst on ${key}`).toHaveLength(5);
    }
  });
});

describe("rateLimit middleware", () => {
  const app = new Hono();
  app.use("*", rateLimit({ bucket: "mw", limit: 2, windowSeconds: 60, key: (c) => c.req.header("x-who") }));
  app.get("/", (c) => c.text("ok"));

  it("answers 429 with Retry-After once the limit is spent", async () => {
    const hit = () => app.request("/", { headers: { "x-who": "someone" } });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const res = await hit();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toBe("rate_limited");
  });

  it("does not count a request that has no key: that is the route's job to refuse, not the limiter's", async () => {
    for (let i = 0; i < 5; i++) expect((await app.request("/")).status).toBe(200);
  });
});
