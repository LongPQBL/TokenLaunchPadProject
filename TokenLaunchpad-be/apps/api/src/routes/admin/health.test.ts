import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../../test/auth.js";
import { addr, seedToken } from "../../../test/seed.js";
import { createApp } from "../../app.js";
import { getSql } from "../../db.js";

const admin = randomAccount();
const app = createApp({
  auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN },
  adminAddresses: [admin.address],
  health: { chainHead: async () => 500n, indexerBlock: async () => 495n, heartbeat: async () => ({ since: "1", at: "2", address: addr(0xb07), balance: "42" }) },
});
const CHAIN_ID = 11155111;
let adminCookie = "";
let userCookie = "";

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
  adminCookie = (await signIn(app, admin)).cookie;
  userCookie = (await signIn(app, randomAccount())).cookie;
  expect(adminCookie).toMatch(/^vezta_session=/);
  expect(userCookie).toMatch(/^vezta_session=/);
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

const health = (cookie: string | null = adminCookie) => app.request("/sepolia/admin/health", { headers: cookie ? { cookie } : {} });
const reResolve = (cookie: string | null = adminCookie, contentType = "application/json") =>
  app.request("/sepolia/admin/metadata/re-resolve", { method: "POST", headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) }, body: "{}" });

describe("GET /:chain/admin/health", () => {
  it("reports the system to an admin, in JSON a browser can read", async () => {
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: addr(0x1), uri: "ipfs://x", status: "invalid" } });
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      indexerLagBlocks: 5,
      watcherAliveSince: "1",
      botAddress: addr(0xb07),
      botBalance: "42",
      failedMetadataCount: 1,
      stuckTokens: [],
    });
  });

  it("answers with what it can when a dependency is not configured at all", async () => {
    const bare = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN }, adminAddresses: [admin.address] });
    const cookie = (await signIn(bare, admin)).cookie;
    const res = await bare.request("/sepolia/admin/health", { headers: { cookie } });
    expect(await res.json()).toEqual({ indexerLagBlocks: null, watcherAliveSince: null, botAddress: null, botBalance: null, failedMetadataCount: 0, stuckTokens: [] });
  });

  it("is refused to a non-admin and an anonymous caller exactly as a path that does not exist", async () => {
    const nothing = await app.request("/sepolia/admin/nothing", { headers: { cookie: userCookie } });
    for (const cookie of [userCookie, null]) {
      const res = await health(cookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(await nothing.clone().json());
    }
  });
});

describe("POST /:chain/admin/metadata/re-resolve", () => {
  const meta = (token: string, status: string, over: Record<string, unknown> = {}) => prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token, uri: "ipfs://x", status, ...over } });

  it("puts every token whose metadata was given up on back to be resolved again, and says how many", async () => {
    await meta(addr(0x1), "invalid", { attempts: 6, nextAttempt: new Date(Date.now() + 86_400_000) });
    await meta(addr(0x2), "invalid", { attempts: 3 });
    const res = await reResolve();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });
    const rows = await prisma.tokenMetadata.findMany({ orderBy: { token: "asc" } });
    expect(rows.map((r) => [r.status, r.attempts, r.nextAttempt])).toEqual([["pending", 0, null], ["pending", 0, null]]);
  });

  it("leaves resolved, waiting and hidden tokens alone, and other chains'", async () => {
    await meta(addr(0x1), "ok", { name: "Fine" });
    await meta(addr(0x2), "pending", { attempts: 2 });
    await meta(addr(0x3), "hidden");
    await prisma.tokenMetadata.create({ data: { chainId: 1, token: addr(0x4), uri: "ipfs://x", status: "invalid" } });
    expect(await (await reResolve()).json()).toEqual({ count: 0 });
    expect((await prisma.tokenMetadata.findMany({ orderBy: { token: "asc" } })).map((r) => r.status)).toEqual(["ok", "pending", "hidden", "invalid"]);
  });

  it("is a no-op the second time", async () => {
    await meta(addr(0x1), "invalid");
    await reResolve();
    expect(await (await reResolve()).json()).toEqual({ count: 0 });
  });

  it("wants JSON, and is refused to a non-admin without changing anything", async () => {
    await meta(addr(0x1), "invalid");
    expect((await reResolve(adminCookie, "text/plain")).status).toBe(400);
    expect((await reResolve(userCookie)).status).toBe(404);
    expect((await reResolve(null)).status).toBe(404);
    expect((await prisma.tokenMetadata.findFirstOrThrow()).status).toBe("invalid");
  });
});
