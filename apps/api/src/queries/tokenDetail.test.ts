import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedBalance, seedToken, seedTrade } from "../../test/seed.js";
import { listHolders } from "./holders.js";
import { getToken } from "./tokenDetail.js";
import { BadTradeCursorError, listTrades } from "./trades.js";

const CHAIN = 11155111;
const T = addr(0xa1);
const DEAD = "0x000000000000000000000000000000000000dead";
const LAUNCHPAD = addr(0x1a);

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

describe("getToken", () => {
  it("returns undefined for an address the indexer has never seen", async () => {
    expect(await getToken(CHAIN, addr(0x99))).toBeUndefined();
  });

  // Review Focus 1: hiding must be complete, or a shared link defeats moderation.
  it("returns undefined for a hidden token, so a direct link cannot bypass moderation", async () => {
    await seedToken({ address: T, name: "Spam", ticker: "SPM" });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: T, uri: "ipfs://x", status: "hidden" } });
    expect(await getToken(CHAIN, T)).toBeUndefined();
  });

  it("returns the curve state as bigint and the on-chain fields", async () => {
    await seedToken({
      address: T, name: "Curve", ticker: "CRV", virtualQuoteReserves: 10n ** 27n, virtualTokenReserves: 5n, pair: addr(0x9a), migrated: true,
    });
    const t = (await getToken(CHAIN, T))!;
    expect(t).toMatchObject({ address: T, name: "Curve", virtualQuoteReserves: 10n ** 27n, virtualTokenReserves: 5n, pair: addr(0x9a), migrated: true });
    expect(t.quoteToken).toBe("0xweth");
    expect(t.antiSniperWindow).toBe(0);
  });

  it("reports pending when there is no metadata row, and serves the on-chain name", async () => {
    await seedToken({ address: T, name: "Fresh", ticker: "FRS" });
    const t = (await getToken(CHAIN, T))!;
    expect(t.metadataStatus).toBe("pending");
    expect(t.name).toBe("Fresh");
    expect(t.socials).toEqual({});
  });

  it("serves resolved metadata only when it is ok", async () => {
    await seedToken({ address: T, name: "OnChain", ticker: "OC" });
    await prisma.tokenMetadata.create({
      data: { chainId: CHAIN, token: T, uri: "ipfs://x", status: "ok", name: "Resolved", imageCdnUrl: "https://cdn/x.png", socials: { website: "https://example.com" } },
    });
    const ok = (await getToken(CHAIN, T))!;
    expect(ok).toMatchObject({ name: "Resolved", imageUrl: "https://cdn/x.png", metadataStatus: "ok", socials: { website: "https://example.com" } });

    await prisma.tokenMetadata.update({ where: { chainId_token: { chainId: CHAIN, token: T } }, data: { status: "invalid" } });
    const invalid = (await getToken(CHAIN, T))!;
    expect(invalid).toMatchObject({ name: "OnChain", metadataStatus: "invalid", socials: {} });
    expect(invalid.imageUrl).toBeUndefined();
  });

  // Review Focus 4, defence in depth: the resolver already drops these, but a row written any other way must
  // still not hand the browser a javascript: URL.
  it("never serves a social link that is not http(s), even if one was stored", async () => {
    await seedToken({ address: T, name: "Links", ticker: "LNK" });
    await prisma.tokenMetadata.create({
      data: { chainId: CHAIN, token: T, uri: "ipfs://x", status: "ok", name: "Links", socials: { website: "javascript:alert(1)", twitter: "https://x.com/ok" } },
    });
    const t = (await getToken(CHAIN, T))!;
    expect(t.socials).toEqual({ twitter: "https://x.com/ok" });
  });

  it("is scoped by chain", async () => {
    await seedToken({ address: T, name: "Elsewhere", ticker: "ELS", chainId: 84532 });
    expect(await getToken(CHAIN, T)).toBeUndefined();
  });
});

describe("listTrades", () => {
  // Review Focus 3: every trade in a block shares a timestamp, and the id sorts by transaction hash.
  it("orders trades in one block by log index, newest first, whatever their ids say", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    await seedTrade({ token: T, blockNumber: 100, logIndex: 8, id: "1-0xaaaa-8" });
    await seedTrade({ token: T, blockNumber: 100, logIndex: 2, id: "1-0xffff-2" });
    await seedTrade({ token: T, blockNumber: 100, logIndex: 5, id: "1-0x5555-5" });
    await seedTrade({ token: T, blockNumber: 101, logIndex: 1, id: "1-0x0001-1" });
    const { items } = await listTrades(CHAIN, T, { limit: 10 });
    expect(items.map((t) => [Number(t.blockNumber), t.logIndex])).toEqual([[101, 1], [100, 8], [100, 5], [100, 2]]);
  });

  it("paginates without repeats or gaps, including when a page ends inside a block", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    for (let block = 100; block < 104; block++) for (let log = 0; log < 3; log++) await seedTrade({ token: T, blockNumber: block, logIndex: log * 2 });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 6; page++) {
      const res = await listTrades(CHAIN, T, { limit: 5, cursor });
      seen.push(...res.items.map((t) => `${t.blockNumber}:${t.logIndex}`));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen[0]).toBe("103:4");
    expect(seen.at(-1)).toBe("100:0");
  });

  it("returns amounts as bigint and only this token's trades on this chain", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, quoteAmount: 10n ** 24n, tokenAmount: 5n });
    await seedTrade({ token: addr(0xa2), blockNumber: 1, logIndex: 1 });
    await seedTrade({ token: T, blockNumber: 1, logIndex: 2, chainId: 84532 });
    const { items } = await listTrades(CHAIN, T, { limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quoteAmount: 10n ** 24n, tokenAmount: 5n });
  });

  it("returns an empty page for a token with no trades", async () => {
    expect(await listTrades(CHAIN, T, { limit: 10 })).toEqual({ items: [] });
  });

  it("rejects a malformed cursor with a typed error", async () => {
    await expect(listTrades(CHAIN, T, { limit: 5, cursor: "nope" })).rejects.toBeInstanceOf(BadTradeCursorError);
    const injection = Buffer.from(JSON.stringify(["1; drop table x", 1])).toString("base64url");
    await expect(listTrades(CHAIN, T, { limit: 5, cursor: injection })).rejects.toBeInstanceOf(BadTradeCursorError);
  });
});

describe("listHolders", () => {
  const holders = (limit = 50, launchpad: string | undefined = LAUNCHPAD) => listHolders(CHAIN, T, { limit, launchpad });

  it("orders by balance, largest first, and omits zero and negative balances", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    await seedBalance({ token: T, holder: addr(1), amount: 10n });
    await seedBalance({ token: T, holder: addr(2), amount: 30n });
    await seedBalance({ token: T, holder: addr(3), amount: 0n });
    await seedBalance({ token: T, holder: addr(4), amount: -5n });
    expect((await holders()).map((h) => [h.holder, h.amount])).toEqual([[addr(2), 30n], [addr(1), 10n]]);
  });

  it("never lists the launchpad, the burn address or, once migrated, the pool", async () => {
    await seedToken({ address: T, name: "T", ticker: "T", pair: addr(0x9a), migrated: true });
    for (const [holder, amount] of [[LAUNCHPAD, 900n], [DEAD, 800n], [addr(0x9a), 700n], [addr(5), 5n]] as const) {
      await seedBalance({ token: T, holder, amount });
    }
    expect((await holders()).map((h) => h.holder)).toEqual([addr(5)]);
  });

  it("does not exclude a pair that is not known yet", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" }); // pair is null until migration
    await seedBalance({ token: T, holder: addr(6), amount: 1n });
    expect((await holders()).map((h) => h.holder)).toEqual([addr(6)]);
  });

  it("respects the limit, and is scoped by chain and token", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    for (let i = 1; i <= 5; i++) await seedBalance({ token: T, holder: addr(i), amount: BigInt(i) });
    await seedBalance({ token: addr(0xa2), holder: addr(9), amount: 99n });
    await seedBalance({ token: T, holder: addr(8), amount: 99n, chainId: 84532 });
    expect(await holders(3)).toHaveLength(3);
    expect((await holders(10)).map((h) => h.holder)).not.toContain(addr(9));
    expect((await holders(10)).map((h) => h.holder)).not.toContain(addr(8));
  });
});
