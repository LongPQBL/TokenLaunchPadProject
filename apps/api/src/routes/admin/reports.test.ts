import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../../test/auth.js";
import { addr, seedToken } from "../../../test/seed.js";
import { createApp } from "../../app.js";
import { getSql } from "../../db.js";

const admin = randomAccount();
const app = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN }, adminAddresses: [admin.address] });
const A = addr(0x41);
const B = addr(0x42);
const CHAIN_ID = 11155111;
let adminCookie = "";
let userCookie = "";
let userAddress = "";

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
  await prisma.report.deleteMany();
  await prisma.tokenMetadata.deleteMany();
  await prisma.appUser.deleteMany();
  await seedToken.reset();
  await seedToken({ address: A, name: "Alpha", ticker: "ALP" });
  await seedToken({ address: B, name: "Beta", ticker: "BET" });
  adminCookie = (await signIn(app, admin)).cookie;
  const user = await signIn(app, randomAccount());
  userCookie = user.cookie;
  userAddress = user.address;
  expect(adminCookie).toMatch(/^vezta_session=/);
  expect(userCookie).toMatch(/^vezta_session=/);
  await prisma.appUser.create({ data: { address: userAddress } });
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

/** `null` is an anonymous caller: `undefined` would take the default, which is the admin. */
const list = (cookie: string | null = adminCookie, chain = "sepolia") => app.request(`/${chain}/admin/reports`, { headers: cookie ? { cookie } : {} });
const resolve = (id: string | bigint, cookie: string | null = adminCookie, contentType = "application/json") =>
  app.request(`/sepolia/admin/reports/${id}/resolve`, { method: "POST", headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) }, body: "{}" });
const report = (token: string, reason: string, over: Record<string, unknown> = {}) =>
  prisma.report.create({ data: { chainId: CHAIN_ID, token, reporter: userAddress, reason, ...over } });

describe("GET /:chain/admin/reports", () => {
  it("lists what has not been dealt with, newest first, with the token it is about", async () => {
    const first = await report(A, "first");
    const second = await report(B, "second");
    await report(A, "old news", { resolved: true });
    const body = (await (await list()).json()) as { items: Record<string, unknown>[] };
    expect(body.items.map((r) => r.id)).toEqual([String(second.id), String(first.id)]);
    expect(body.items[0]).toMatchObject({ token: B, name: "Beta", ticker: "BET", reporter: userAddress, reason: "second", hidden: false });
    expect(body.items[0]!.createdAt).toMatch(/^\d+$/);
  });

  it("still lists a report about a token that has since been hidden, and says so: it may need dealing with", async () => {
    await report(A, "spam");
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: A, uri: "ipfs://x", status: "hidden" } });
    const body = (await (await list()).json()) as { items: { hidden: boolean }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.hidden).toBe(true);
  });

  it("gives a reason back exactly as written: it is hostile text, and drawing it as text is the page's job", async () => {
    await report(A, "<script>alert(1)</script>");
    const body = (await (await list()).json()) as { items: { reason: string }[] };
    expect(body.items[0]!.reason).toBe("<script>alert(1)</script>");
  });

  it("shows only this chain's reports", async () => {
    await report(A, "here");
    await prisma.report.create({ data: { chainId: 1, token: A, reporter: userAddress, reason: "mainnet" } });
    const body = (await (await list()).json()) as { items: { reason: string }[] };
    expect(body.items.map((r) => r.reason)).toEqual(["here"]);
  });

  it("is an empty list, not an error, when there is nothing to deal with", async () => {
    expect(await (await list()).json()).toEqual({ items: [] });
  });

  it("stops at a hundred: a flood must not become a page nobody can load", async () => {
    await prisma.appUser.createMany({ data: Array.from({ length: 110 }, (_, i) => ({ address: addr(0x1000 + i) })) });
    await prisma.report.createMany({ data: Array.from({ length: 110 }, (_, i) => ({ chainId: CHAIN_ID, token: A, reporter: addr(0x1000 + i), reason: `r${i}` })) });
    const body = (await (await list()).json()) as { items: unknown[] };
    expect(body.items).toHaveLength(100);
  });

  it("is refused to a non-admin and an anonymous caller exactly as a path that does not exist", async () => {
    await report(A, "secret");
    const nothing = await app.request("/sepolia/admin/nothing", { headers: { cookie: userCookie } });
    for (const cookie of [userCookie, null]) {
      const res = await list(cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(await nothing.clone().json());
    }
  });
});

describe("POST /:chain/admin/reports/:id/resolve", () => {
  it("settles a report, which then leaves the list, and keeps the row", async () => {
    const r = await report(A, "spam");
    const res = await resolve(r.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: String(r.id), resolved: true });
    expect(await (await list()).json()).toEqual({ items: [] });
    expect((await prisma.report.findUniqueOrThrow({ where: { id: r.id } })).resolved).toBe(true);
  });

  it("is idempotent", async () => {
    const r = await report(A, "spam");
    expect((await resolve(r.id)).status).toBe(200);
    expect((await resolve(r.id)).status).toBe(200);
  });

  it("answers 404 for one that does not exist or is on another chain, and 400 for an id that is not a number", async () => {
    const elsewhere = await prisma.report.create({ data: { chainId: 1, token: A, reporter: userAddress, reason: "mainnet" } });
    expect((await resolve("999999")).status).toBe(404);
    expect((await resolve(elsewhere.id)).status).toBe(404);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: elsewhere.id } })).resolved).toBe(false);
    for (const bad of ["abc", "1e3", "-1"]) expect((await resolve(bad)).status, bad).toBe(400);
  });

  it("wants JSON, and refuses a non-admin without changing anything", async () => {
    const r = await report(A, "spam");
    expect((await resolve(r.id, adminCookie, "text/plain")).status).toBe(400);
    expect((await resolve(r.id, userCookie)).status).toBe(404);
    expect((await resolve(r.id, null)).status).toBe(404);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: r.id } })).resolved).toBe(false);
  });
});
