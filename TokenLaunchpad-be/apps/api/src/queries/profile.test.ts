import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetAppData } from "../../test/app-data.js";
import { addr, seedBalance, seedToken } from "../../test/seed.js";
import { getSql } from "../db.js";
import { getProfile } from "./profile.js";

const CHAIN_ID = 11155111;
const ME = addr(0xa1);
const OTHER = addr(0xa2);

beforeEach(async () => {
  await resetAppData();
  await seedToken.reset();
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

const made = (address: string, over: Partial<Parameters<typeof seedToken>[0]> = {}) => seedToken({ address, creator: ME, name: `T${address.slice(-2)}`, ticker: "TKN", ...over });

describe("getProfile", () => {
  // Review Focus 5: an address that has never touched the launchpad is not an error.
  it("returns empty lists for an address that has never used the launchpad", async () => {
    await made(addr(0x1), { creator: OTHER });
    expect(await getProfile(CHAIN_ID, "0x" + "0".repeat(40))).toEqual({ created: [], holdings: [] });
  });

  it("lists the tokens an address created, newest first, and no one else's", async () => {
    await made(addr(0x1), { createdAt: 100 });
    await made(addr(0x2), { createdAt: 300 });
    await made(addr(0x3), { createdAt: 200 });
    await made(addr(0x4), { creator: OTHER, createdAt: 400 });
    expect((await getProfile(CHAIN_ID, ME)).created.map((t) => t.address)).toEqual([addr(0x2), addr(0x3), addr(0x1)]);
  });

  it("describes each created token the way the list does", async () => {
    await made(addr(0x1), { volumeQuote: 5n, tradeCount: 2, progressBps: 300, complete: false });
    const [t] = (await getProfile(CHAIN_ID, ME)).created;
    expect(t).toMatchObject({ address: addr(0x1), creator: ME, ticker: "TKN", volumeQuote: 5n, tradeCount: 2, progressBps: 300, complete: false, migrated: false });
  });

  it("lists what an address holds, biggest first, each with its token", async () => {
    await made(addr(0x1), { creator: OTHER });
    await made(addr(0x2), { creator: OTHER });
    await seedBalance({ token: addr(0x1), holder: ME, amount: 5n });
    await seedBalance({ token: addr(0x2), holder: ME, amount: 50n });
    const { holdings } = await getProfile(CHAIN_ID, ME);
    expect(holdings.map((h) => [h.token.address, h.amount])).toEqual([[addr(0x2), 50n], [addr(0x1), 5n]]);
  });

  it("omits a zero balance: selling everything leaves nothing to show", async () => {
    await made(addr(0x1), { creator: OTHER });
    await made(addr(0x2), { creator: OTHER });
    await seedBalance({ token: addr(0x1), holder: ME, amount: 0n });
    await seedBalance({ token: addr(0x2), holder: ME, amount: 1n });
    expect((await getProfile(CHAIN_ID, ME)).holdings.map((h) => h.token.address)).toEqual([addr(0x2)]);
  });

  it("leaves a hidden token out of both lists", async () => {
    await made(addr(0x1));
    await made(addr(0x2));
    await seedBalance({ token: addr(0x1), holder: ME, amount: 5n });
    await seedBalance({ token: addr(0x2), holder: ME, amount: 5n });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: addr(0x1), uri: "ipfs://x", status: "hidden" } });
    const p = await getProfile(CHAIN_ID, ME);
    expect(p.created.map((t) => t.address)).toEqual([addr(0x2)]);
    expect(p.holdings.map((h) => h.token.address)).toEqual([addr(0x2)]);
  });

  it("does not leave a hidden token's name in a holding: the row is not there at all", async () => {
    await made(addr(0x1), { creator: OTHER, name: "Offensive" });
    await seedBalance({ token: addr(0x1), holder: ME, amount: 5n });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: addr(0x1), uri: "ipfs://x", status: "hidden" } });
    expect(JSON.stringify((await getProfile(CHAIN_ID, ME)).holdings, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain("Offensive");
  });

  it("is scoped to one chain", async () => {
    await made(addr(0x1), { chainId: 1 });
    await made(addr(0x2), { creator: OTHER, chainId: 1 });
    await seedBalance({ token: addr(0x2), holder: ME, amount: 5n, chainId: 1 });
    expect(await getProfile(CHAIN_ID, ME)).toEqual({ created: [], holdings: [] });
  });

  it("still lists a token that has no metadata row yet: a token made a moment ago must show", async () => {
    await made(addr(0x1));
    expect((await getProfile(CHAIN_ID, ME)).created).toHaveLength(1);
  });

  it("does not let a pending or invalid metadata row rename or re-image a token", async () => {
    await made(addr(0x1), { name: "Chain Name" });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: addr(0x1), uri: "ipfs://x", status: "invalid", name: "<script>", imageCdnUrl: "javascript:alert(1)" } });
    const [t] = (await getProfile(CHAIN_ID, ME)).created;
    expect(t).toMatchObject({ name: "Chain Name" });
    expect(t!.imageUrl).toBeUndefined();
  });

  it("stops at a hundred created tokens", async () => {
    await getSql()`
      insert into launchpad.token (chain_id, address, creator, quote_token, anti_sniper_window, created_at)
      select ${CHAIN_ID}, '0x' || lpad(to_hex(g), 40, '0'), ${ME}, '0xweth', 0, g from generate_series(1, 130) g`;
    expect((await getProfile(CHAIN_ID, ME)).created).toHaveLength(100);
  });
});
