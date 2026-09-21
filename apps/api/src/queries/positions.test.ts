import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedBalance, seedToken, seedTrade } from "../../test/seed.js";
import { BadOrderCursorError, listOrders, listPositions } from "./positions.js";

const CHAIN = 11155111;
const ME = addr(0xabc);
const OTHER = addr(0xdef);
const A = addr(0xa1);
const B = addr(0xb2);
const C = addr(0xc3);
const txHash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const id = (n: number, log = 0) => `${CHAIN}-${txHash(n)}-${log}`;

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

/** Token A: the price is 2 quote per token (vq 2000, vt 1000). ME bought 50 for 100+10, bought 100 for 200+20, sold 60 for 150-15, and holds 90. */
async function seedA() {
  await seedToken({ address: A, name: "Alpha", ticker: "ALP", virtualQuoteReserves: 2_000n, virtualTokenReserves: 1_000n });
  await seedBalance({ token: A, holder: ME, amount: 90n });
  await seedTrade({ id: id(1), token: A, trader: ME, isBuy: true, quoteAmount: 100n, fee: 10n, tokenAmount: 50n, blockNumber: 1, logIndex: 0 });
  await seedTrade({ id: id(2), token: A, trader: ME, isBuy: true, quoteAmount: 200n, fee: 20n, tokenAmount: 100n, blockNumber: 2, logIndex: 0 });
  await seedTrade({ id: id(3), token: A, trader: ME, isBuy: false, quoteAmount: 150n, fee: 15n, tokenAmount: 60n, blockNumber: 3, logIndex: 0 });
}

describe("positions", () => {
  it("counts what was paid for the buys with their fees, what came back from the sells net of theirs, and how many of each", async () => {
    await seedA();
    const [p] = await listPositions(CHAIN, ME);
    expect(p).toMatchObject({ balance: 90n, spent: 330n, received: 135n, buys: 2, sells: 1 });
  });

  it("values the balance at the price the curve is at now, and takes the profit as value plus what came back, less what went in", async () => {
    await seedA();
    const [p] = await listPositions(CHAIN, ME);
    expect(p!.value).toBe(180n); // 90 * 2000 / 1000
    expect(p!.pnl).toBe(-15n); // 180 + 135 - 330
    expect(p!.pnlBps).toBe(-455); // -15 / 330
  });

  it("names the token, and says so when the metadata never resolved: the on-chain name", async () => {
    await seedA();
    expect((await listPositions(CHAIN, ME))[0]!.token).toMatchObject({ address: A, name: "Alpha", ticker: "ALP" });
  });

  it("has no percentage for tokens that were never paid for (they came by transfer), and the whole value is its gain", async () => {
    await seedToken({ address: B, name: "Gift", ticker: "GFT", virtualQuoteReserves: 2_000n, virtualTokenReserves: 1_000n });
    await seedBalance({ token: B, holder: ME, amount: 10n });
    const [p] = await listPositions(CHAIN, ME);
    expect(p).toMatchObject({ spent: 0n, received: 0n, buys: 0, sells: 0, value: 20n, pnl: 20n, pnlBps: null });
  });

  it("lists only what is held now: a token sold out, or never held, has no position", async () => {
    await seedA();
    await seedToken({ address: C, name: "Gone", ticker: "GON", virtualQuoteReserves: 2_000n, virtualTokenReserves: 1_000n });
    await seedTrade({ id: id(4), token: C, trader: ME, isBuy: true, quoteAmount: 10n, fee: 1n, tokenAmount: 5n, blockNumber: 4, logIndex: 0 });
    await seedTrade({ id: id(5), token: C, trader: ME, isBuy: false, quoteAmount: 10n, fee: 1n, tokenAmount: 5n, blockNumber: 5, logIndex: 0 });
    await seedBalance({ token: C, holder: ME, amount: 0n });
    expect((await listPositions(CHAIN, ME)).map((p) => p.token.address)).toEqual([A]);
  });

  it("never mixes in someone else's balance or trades, or another chain's", async () => {
    await seedA();
    await seedBalance({ token: A, holder: OTHER, amount: 1_000n });
    await seedTrade({ id: id(6), token: A, trader: OTHER, isBuy: true, quoteAmount: 999n, fee: 9n, tokenAmount: 400n, blockNumber: 6, logIndex: 0 });
    await seedTrade({ id: `1-${txHash(7)}-0`, chainId: 1, token: A, trader: ME, isBuy: true, quoteAmount: 777n, fee: 7n, tokenAmount: 1n, blockNumber: 7, logIndex: 0 });
    const [p] = await listPositions(CHAIN, ME);
    expect(p).toMatchObject({ balance: 90n, spent: 330n });
    expect(await listPositions(CHAIN, OTHER)).toHaveLength(1);
  });

  it("keeps a hidden token: moderation must not make anyone's holding unreachable", async () => {
    await seedA();
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: A, uri: "ipfs://x", status: "hidden" } });
    expect((await listPositions(CHAIN, ME)).map((p) => p.token.address)).toEqual([A]);
  });

  it("values a token with no reserves at nothing, rather than dividing by them", async () => {
    await seedToken({ address: B, name: "Raw", ticker: "RAW" });
    await seedBalance({ token: B, holder: ME, amount: 10n });
    expect((await listPositions(CHAIN, ME))[0]).toMatchObject({ value: 0n, pnl: 0n });
  });

  it("puts the most valuable first", async () => {
    await seedA();
    await seedToken({ address: B, name: "Big", ticker: "BIG", virtualQuoteReserves: 9_000n, virtualTokenReserves: 1_000n });
    await seedBalance({ token: B, holder: ME, amount: 100n });
    expect((await listPositions(CHAIN, ME)).map((p) => p.token.address)).toEqual([B, A]);
  });
});

describe("orders", () => {
  async function seedOrders() {
    await seedA();
    await seedToken({ address: B, name: "Beta", ticker: "BET", virtualQuoteReserves: 2_000n, virtualTokenReserves: 1_000n });
    await seedTrade({ id: id(8), token: B, trader: ME, isBuy: true, quoteAmount: 40n, fee: 4n, tokenAmount: 20n, blockNumber: 4, logIndex: 1, timestamp: 1_700_000_040 });
    await seedTrade({ id: id(9), token: B, trader: OTHER, isBuy: true, quoteAmount: 41n, fee: 4n, tokenAmount: 21n, blockNumber: 4, logIndex: 2 });
  }

  it("lists a person's trades on every token, newest first, and nobody else's", async () => {
    await seedOrders();
    const { items } = await listOrders(CHAIN, ME, { limit: 10 });
    expect(items.map((o) => [o.token.address, o.blockNumber, o.logIndex])).toEqual([
      [B, 4n, 1],
      [A, 3n, 0],
      [A, 2n, 0],
      [A, 1n, 0],
    ]);
  });

  it("gives what was really paid or received: a buy costs the price plus the fee, a sell pays the price less it", async () => {
    await seedOrders();
    const { items } = await listOrders(CHAIN, ME, { limit: 10 });
    const bySide = (isBuy: boolean, blockNumber: bigint) => items.find((o) => o.isBuy === isBuy && o.blockNumber === blockNumber)!;
    expect(bySide(true, 1n)).toMatchObject({ quoteAmount: 100n, fee: 10n, total: 110n, tokenAmount: 50n });
    expect(bySide(false, 3n)).toMatchObject({ quoteAmount: 150n, fee: 15n, total: 135n, tokenAmount: 60n });
  });

  it("gives the price paid per whole token, the transaction, the time and the token's name", async () => {
    await seedOrders();
    const order = (await listOrders(CHAIN, ME, { limit: 10 })).items.find((o) => o.token.address === B)!;
    expect(order).toMatchObject({ txHash: txHash(8), timestamp: 1_700_000_040n, token: { name: "Beta", ticker: "BET" } });
    expect(order.price).toBe(2n * 10n ** 18n); // 40 quote for 20 token units = 2 per unit, per whole token (1e18 units)
  });

  it("pages with a cursor, without repeating or skipping an order", async () => {
    await seedOrders();
    const first = await listOrders(CHAIN, ME, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = await listOrders(CHAIN, ME, { limit: 3, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect([...first.items, ...second.items].map((o) => `${o.blockNumber}-${o.logIndex}`)).toEqual(["4-1", "3-0", "2-0", "1-0"]);
  });

  it("leaves another chain's trades out, even for a token with the same address there", async () => {
    await seedOrders();
    await seedToken({ address: A, chainId: 1, name: "Twin", ticker: "TWN" });
    await seedTrade({ id: `1-${txHash(50)}-0`, chainId: 1, token: A, trader: ME, isBuy: true, quoteAmount: 5n, fee: 1n, tokenAmount: 1n, blockNumber: 50, logIndex: 0 });
    const { items } = await listOrders(CHAIN, ME, { limit: 10 });
    expect(items).toHaveLength(4);
    expect(items.map((o) => o.blockNumber)).not.toContain(50n);
  });

  it("keeps a hidden token's orders: they are the person's own history", async () => {
    await seedOrders();
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: B, uri: "ipfs://x", status: "hidden" } });
    expect((await listOrders(CHAIN, ME, { limit: 10 })).items.map((o) => o.token.address)).toContain(B);
  });

  it("refuses a cursor that is not one", async () => {
    await expect(listOrders(CHAIN, ME, { limit: 3, cursor: "zzz" })).rejects.toBeInstanceOf(BadOrderCursorError);
    const forged = Buffer.from(JSON.stringify(["-1", 0])).toString("base64url");
    await expect(listOrders(CHAIN, ME, { limit: 3, cursor: forged })).rejects.toBeInstanceOf(BadOrderCursorError);
  });

  it("is empty for an address that never traded", async () => {
    await seedOrders();
    expect(await listOrders(CHAIN, addr(0x999), { limit: 10 })).toEqual({ items: [] });
  });
});
