import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI, type TestAccount } from "../../test/auth.js";
import { addr, seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";
import { getSql } from "../db.js";
import { resetAppData } from "../../test/app-data.js";

const published: { chain: string; token: string; comment: { id: string; body: string; author: string } }[] = [];
const app = createApp({
  auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN },
  publishComment: async (chain, token, comment) => void published.push({ chain, token, comment }),
});
const T = addr(0x77);
const NUL = String.fromCharCode(0);

beforeEach(async () => {
  published.length = 0;
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
  await resetAppData();
  await seedToken.reset();
  await seedToken({ address: T, name: "Demo", ticker: "DEMO" });
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

const post = (cookie: string | undefined, body: unknown, token = T, contentType = "application/json") =>
  app.request(`/sepolia/tokens/${token}/comments`, {
    method: "POST",
    headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const asUser = async (account?: TestAccount) => signIn(app, account);

describe("POST /:chain/tokens/:address/comments", () => {
  it("needs a session, and writes nothing without one", async () => {
    const res = await post(undefined, { body: "hi" });
    expect(res.status).toBe(401);
    expect(await prisma.comment.count()).toBe(0);
  });

  it("creates a comment and returns it as the list would show it", async () => {
    const { cookie, address } = await asUser();
    const res = await post(cookie, { body: "gm" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ author: address, body: "gm" });
    expect(body.id).toMatch(/^\d+$/);
    expect(body.createdAt).toMatch(/^\d+$/);
    expect(await prisma.comment.count()).toBe(1);
  });

  it("shows up in the list straight away", async () => {
    const { cookie } = await asUser();
    await post(cookie, { body: "first!" });
    const list = (await (await app.request(`/sepolia/tokens/${T}/comments`)).json()) as { items: { body: string }[] };
    expect(list.items.map((c) => c.body)).toEqual(["first!"]);
  });

  it("makes an account for a first-time commenter, once", async () => {
    const { cookie, address } = await asUser();
    await post(cookie, { body: "one" });
    await post(cookie, { body: "two" });
    expect(await prisma.appUser.findMany({ where: { address } })).toHaveLength(1);
  });

  // A client must not be able to speak as someone else.
  it("attributes the comment to the SESSION address, whatever the body says", async () => {
    const { cookie, address } = await asUser();
    const res = await post(cookie, { body: "hi", author: "0x00000000000000000000000000000000deadbeef", chainId: 1, hidden: true });
    expect(((await res.json()) as { author: string }).author).toBe(address);
    const row = await prisma.comment.findFirstOrThrow();
    expect(row).toMatchObject({ author: address, chainId: 11155111, hidden: false });
  });

  it("stores markup exactly as written: escaping is the renderer's job", async () => {
    const { cookie } = await asUser();
    const res = await post(cookie, { body: "<script>alert(1)</script>" });
    expect(((await res.json()) as { body: string }).body).toBe("<script>alert(1)</script>");
    expect((await prisma.comment.findFirstOrThrow()).body).toBe("<script>alert(1)</script>");
  });

  it("rejects a body over 500 characters, and exactly 500 is fine (counted as a person counts: an emoji is one)", async () => {
    const { cookie } = await asUser();
    expect((await post(cookie, { body: "x".repeat(501) })).status).toBe(400);
    expect((await post(cookie, { body: "x".repeat(500) })).status).toBe(201);
    expect((await post(cookie, { body: "😀".repeat(500) })).status).toBe(201);
    expect((await post(cookie, { body: "😀".repeat(501) })).status).toBe(400);
  });

  it("rejects an empty or whitespace-only body, and trims the ends of a real one", async () => {
    const { cookie } = await asUser();
    for (const body of ["", "   ", "\n \n"]) expect((await post(cookie, { body })).status, JSON.stringify(body)).toBe(400);
    const res = await post(cookie, { body: "  padded  " });
    expect(((await res.json()) as { body: string }).body).toBe("padded");
    expect((await prisma.comment.findFirstOrThrow()).body).toBe("padded"); // and it is what is stored, not only what is returned
  });

  it("rejects what is not a comment: no body, a non-string, a NUL character (the database cannot hold one), bad JSON, another content type", async () => {
    const { cookie } = await asUser();
    for (const body of [{}, { body: 5 }, { body: null }, { body: ["a"] }, { body: `has${NUL}nul` }]) {
      expect((await post(cookie, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(cookie, "{not json")).status).toBe(400);
    expect((await post(cookie, "body=hi", T, "application/x-www-form-urlencoded")).status).toBe(400);
    expect((await post(cookie, "hi", T, "text/plain")).status).toBe(400);
    // A page on another site can send a "simple" cross-site request with a text/plain body that is valid JSON. Refused by type.
    expect((await post(cookie, JSON.stringify({ body: "hi" }), T, "text/plain")).status).toBe(400);
    expect(await prisma.comment.count()).toBe(0);
  });

  it("refuses a request far bigger than any comment, before reading it", async () => {
    const { cookie } = await asUser();
    expect((await post(cookie, { body: "x".repeat(50_000) })).status).toBe(413);
  });

  it("refuses a banned author, and nothing is written", async () => {
    const { cookie, address } = await asUser();
    await prisma.appUser.upsert({ where: { address }, create: { address, bannedAt: new Date() }, update: { bannedAt: new Date() } });
    const res = await post(cookie, { body: "let me in" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("banned");
    expect(await prisma.comment.count()).toBe(0);
  });

  it("does not let a ban be undone by trying again: a banned person stays banned", async () => {
    const { cookie, address } = await asUser();
    await prisma.appUser.upsert({ where: { address }, create: { address, bannedAt: new Date() }, update: { bannedAt: new Date() } });
    await post(cookie, { body: "a" });
    await post(cookie, { body: "b" });
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address } })).bannedAt).not.toBeNull();
  });

  it("refuses a comment on a hidden token: for this person the token does not exist", async () => {
    const { cookie } = await asUser();
    await prisma.tokenMetadata.create({ data: { chainId: 11155111, token: T, uri: "ipfs://x", status: "hidden" } });
    expect((await post(cookie, { body: "hello" })).status).toBe(404);
    expect(await prisma.comment.count()).toBe(0);
  });

  it("refuses a comment on a token that does not exist, and on something that is not an address", async () => {
    const { cookie } = await asUser();
    expect((await post(cookie, { body: "hi" }, addr(0x99))).status).toBe(404);
    expect((await post(cookie, { body: "hi" }, "not-an-address")).status).toBe(400);
  });

  it("limits each address to ten comments a minute, and counts each address on its own", async () => {
    const a = await asUser();
    const b = await asUser(randomAccount());
    for (let i = 0; i < 10; i++) expect((await post(a.cookie, { body: `c${i}` })).status, `comment ${i + 1}`).toBe(201);
    const eleventh = await post(a.cookie, { body: "one too many" });
    expect(eleventh.status).toBe(429);
    expect(Number(eleventh.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(b.cookie, { body: "still fine" })).status).toBe(201);
  });

  it("does not count a comment that was refused as invalid: fixing a typo is free", async () => {
    const { cookie } = await asUser();
    for (let i = 0; i < 20; i++) await post(cookie, { body: "" });
    for (let i = 0; i < 10; i++) expect((await post(cookie, { body: `c${i}` })).status).toBe(201);
  });

  describe("telling the live room", () => {
    it("publishes a saved comment to the token's room, once", async () => {
      const { cookie, address } = await asUser();
      await post(cookie, { body: "live!" });
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({ chain: "sepolia", token: T, comment: { body: "live!", author: address } });
    });

    it("publishes nothing for a comment that was refused: not banned, not hidden token, not rate-limited, not invalid, not anonymous", async () => {
      const { cookie, address } = await asUser();
      await post(undefined, { body: "anon" });
      await post(cookie, { body: "" });
      await prisma.tokenMetadata.create({ data: { chainId: 11155111, token: T, uri: "ipfs://x", status: "hidden" } });
      await post(cookie, { body: "on a hidden token" });
      await prisma.tokenMetadata.deleteMany();
      await prisma.appUser.upsert({ where: { address }, create: { address, bannedAt: new Date() }, update: { bannedAt: new Date() } });
      await post(cookie, { body: "banned" });
      expect(published).toEqual([]);
    });

    it("still saves and answers when publishing fails", async () => {
      const failing = createApp({
        auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN },
        publishComment: async () => {
          throw new Error("redis down");
        },
      });
      const { cookie } = await signIn(failing);
      const res = await failing.request(`/sepolia/tokens/${T}/comments`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ body: "saved anyway" }) });
      expect(res.status).toBe(201);
      expect(await prisma.comment.count()).toBe(1);
    });
  });
});
