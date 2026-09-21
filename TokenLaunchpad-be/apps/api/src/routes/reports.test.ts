import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../test/auth.js";
import { addr, seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";
import { getSql } from "../db.js";
import { resetAppData } from "../../test/app-data.js";

const app = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN } });
const T = addr(0x61);
const NUL = String.fromCharCode(0);

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
  await resetAppData();
  await seedToken.reset();
  await seedToken({ address: T, name: "Demo", ticker: "DEMO" });
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

const report = (cookie: string | undefined, body: unknown, token = T, contentType = "application/json") =>
  app.request(`/sepolia/tokens/${token}/report`, {
    method: "POST",
    headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const session = async () => {
  const signed = await signIn(app, randomAccount());
  expect(signed.cookie).toMatch(/^vezta_session=/);
  return signed;
};

describe("POST /:chain/tokens/:address/report", () => {
  it("needs a session, and writes nothing without one", async () => {
    expect((await report(undefined, { reason: "scam" })).status).toBe(401);
    expect(await prisma.report.count()).toBe(0);
  });

  it("files a report for the token, from the session's address", async () => {
    const { cookie, address } = await session();
    const res = await report(cookie, { reason: "This is a scam" });
    expect(res.status).toBe(201);
    expect(await prisma.report.findFirstOrThrow()).toMatchObject({ chainId: 11155111, token: T, reporter: address, reason: "This is a scam", resolved: false });
  });

  // A client must not be able to report as someone else, or file a report that starts out settled.
  it("takes nothing from the body but the reason", async () => {
    const { cookie, address } = await session();
    await report(cookie, { reason: "spam", reporter: addr(0xdead), resolved: true, chainId: 1, token: addr(0x99) });
    expect(await prisma.report.findFirstOrThrow()).toMatchObject({ reporter: address, resolved: false, chainId: 11155111, token: T });
  });

  it("trims the reason, counts it as a person does, and stores markup as written", async () => {
    const { cookie } = await session();
    expect((await report(cookie, { reason: "  <b>bad</b>  " })).status).toBe(201);
    expect((await prisma.report.findFirstOrThrow()).reason).toBe("<b>bad</b>");
    await prisma.report.deleteMany();
    expect((await report(cookie, { reason: "x".repeat(281) })).status).toBe(400);
    expect((await report(cookie, { reason: "😀".repeat(280) })).status).toBe(201);
  });

  it("rejects an empty or missing reason, one that is not text, and a NUL", async () => {
    const { cookie } = await session();
    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: 5 }, { reason: null }, { reason: `a${NUL}b` }]) {
      expect((await report(cookie, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.report.count()).toBe(0);
  });

  it("wants JSON, and refuses a huge request before reading it", async () => {
    const { cookie } = await session();
    expect((await report(cookie, JSON.stringify({ reason: "x" }), T, "text/plain")).status).toBe(400);
    expect((await report(cookie, "reason=x", T, "application/x-www-form-urlencoded")).status).toBe(400);
    expect((await report(cookie, { reason: "x".repeat(50_000) })).status).toBe(413);
    expect(await prisma.report.count()).toBe(0);
  });

  it("does not file the same complaint twice: a second report of the same token by the same person is accepted and changes nothing", async () => {
    const { cookie } = await session();
    expect((await report(cookie, { reason: "first" })).status).toBe(201);
    const again = await report(cookie, { reason: "second" });
    expect(again.status).toBe(200);
    expect(await prisma.report.count()).toBe(1);
  });

  it("does not use up the hourly five when someone tells a moderator about the same token again", async () => {
    const { cookie } = await session();
    await report(cookie, { reason: "first" });
    for (let i = 0; i < 20; i++) expect((await report(cookie, { reason: "again" })).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      const t = addr(0xa0 + i);
      await seedToken({ address: t, name: `T${i}`, ticker: `T${i}` });
      expect((await report(cookie, { reason: "spam" }, t)).status, `other token ${i + 1}`).toBe(201); // four more are still allowed
    }
  });

  it("comes out as one report when the same complaint is sent five times at once, and none of them fails", async () => {
    const { cookie } = await session();
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => report(cookie, { reason: `r${i}` })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await prisma.report.count()).toBe(1);
  });

  it("lets a second person report the same token, and the same person report it again once it was dealt with", async () => {
    const a = await session();
    const b = await session();
    await report(a.cookie, { reason: "one" });
    expect((await report(b.cookie, { reason: "two" })).status).toBe(201);
    await prisma.report.updateMany({ data: { resolved: true } });
    expect((await report(a.cookie, { reason: "again" })).status).toBe(201);
    expect(await prisma.report.count()).toBe(3);
  });

  it("limits each person to five reports an hour, across tokens", async () => {
    const { cookie } = await session();
    for (let i = 0; i < 5; i++) {
      const t = addr(0x70 + i);
      await seedToken({ address: t, name: `T${i}`, ticker: `T${i}` });
      expect((await report(cookie, { reason: "spam" }, t)).status, `report ${i + 1}`).toBe(201);
    }
    const t6 = addr(0x80);
    await seedToken({ address: t6, name: "T6", ticker: "T6" });
    const sixth = await report(cookie, { reason: "spam" }, t6);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await report((await session()).cookie, { reason: "spam" }, t6)).status).toBe(201); // someone else is unaffected
  });

  it("does not count a refused report against the limit", async () => {
    const { cookie } = await session();
    for (let i = 0; i < 10; i++) await report(cookie, { reason: "" });
    for (let i = 0; i < 5; i++) {
      const t = addr(0x90 + i);
      await seedToken({ address: t, name: `T${i}`, ticker: `T${i}` });
      expect((await report(cookie, { reason: "spam" }, t)).status).toBe(201);
    }
  });

  it("answers 404 for a token that is hidden or unknown, as for everyone else", async () => {
    const { cookie } = await session();
    await prisma.tokenMetadata.create({ data: { chainId: 11155111, token: T, uri: "ipfs://x", status: "hidden" } });
    expect((await report(cookie, { reason: "spam" })).status).toBe(404);
    expect((await report(cookie, { reason: "spam" }, addr(0x99))).status).toBe(404);
    expect(await prisma.report.count()).toBe(0);
  });
});
