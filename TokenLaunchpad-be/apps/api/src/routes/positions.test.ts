import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedBalance, seedToken, seedTrade } from "../../test/seed.js";
import { createApp } from "../app.js";

const app = createApp({});
const get = (path: string) => app.request(path);
const ME = addr(0xabc);
const A = addr(0xa1);
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
  await seedToken({ address: A, name: "Alpha", ticker: "ALP", virtualQuoteReserves: 2_000n, virtualTokenReserves: 1_000n });
  await seedBalance({ token: A, holder: ME, amount: 90n });
  await seedTrade({ id: `11155111-${tx(1)}-0`, token: A, trader: ME, isBuy: true, quoteAmount: 100n, fee: 10n, tokenAmount: 50n, blockNumber: 1, logIndex: 0 });
  await seedTrade({ id: `11155111-${tx(2)}-0`, token: A, trader: ME, isBuy: false, quoteAmount: 150n, fee: 15n, tokenAmount: 60n, blockNumber: 2, logIndex: 0 });
});
afterAll(() => prisma.$disconnect());

describe("GET /:chain/addresses/:address/positions", () => {
  it("lists what an address holds, with the amounts as decimal strings and the percentage as a number", async () => {
    const res = await get(`/sepolia/addresses/${ME}/positions`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Record<string, unknown>[] };
    expect(items).toEqual([
      {
        token: { address: A, name: "Alpha", ticker: "ALP" },
        balance: "90",
        spent: "110",
        received: "135",
        buys: 1,
        sells: 1,
        value: "180",
        pnl: "205",
        pnlBps: 18_636, // 205 / 110
      },
    ]);
  });

  it("takes the address in any case, refuses what is not one, and knows only its own chains", async () => {
    expect((await get(`/sepolia/addresses/${ME.toUpperCase().replace("0X", "0x")}/positions`)).status).toBe(200);
    expect((await get("/sepolia/addresses/nope/positions")).status).toBe(400);
    expect((await get(`/nochain/addresses/${ME}/positions`)).status).toBe(404);
  });

  it("is an empty list, not an error, for an address that holds nothing", async () => {
    expect(await (await get(`/sepolia/addresses/${addr(0x999)}/positions`)).json()).toEqual({ items: [] });
  });
});

describe("GET /:chain/addresses/:address/orders", () => {
  it("lists an address's trades newest first, with the totals as decimal strings", async () => {
    const res = await get(`/sepolia/addresses/${ME}/orders`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Record<string, unknown>[] };
    expect(items.map((o) => [o.isBuy, o.total, o.txHash])).toEqual([
      [false, "135", tx(2)],
      [true, "110", tx(1)],
    ]);
    expect(items[0]).toMatchObject({ token: { address: A, name: "Alpha" }, quoteAmount: "150", fee: "15", tokenAmount: "60", blockNumber: "2", logIndex: 0 });
  });

  it("pages with a cursor, and clamps a silly limit rather than refusing it", async () => {
    const first = (await (await get(`/sepolia/addresses/${ME}/orders?limit=1`)).json()) as { items: unknown[]; nextCursor?: string };
    expect(first.items).toHaveLength(1);
    const second = (await (await get(`/sepolia/addresses/${ME}/orders?limit=1&cursor=${first.nextCursor}`)).json()) as { items: unknown[]; nextCursor?: string };
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    for (const limit of ["abc", "0", "-3", "100000"]) expect((await get(`/sepolia/addresses/${ME}/orders?limit=${limit}`)).status, limit).toBe(200);
  });

  it("refuses a malformed cursor and a bad address, each with its own code", async () => {
    const cursor = await get(`/sepolia/addresses/${ME}/orders?cursor=zzz`);
    expect(cursor.status).toBe(400);
    expect(((await cursor.json()) as { error: string }).error).toBe("bad_cursor");
    const address = await get("/sepolia/addresses/nope/orders");
    expect(((await address.json()) as { error: string }).error).toBe("bad_address");
  });
});
