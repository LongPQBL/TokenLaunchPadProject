import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedToken, seedTrade } from "../../test/seed.js";
import { createApp } from "../app.js";

const app = createApp({ corsOrigins: [], ready: async () => true });
const get = (path: string) => app.request(path);
const T = addr(0xf1);
const T0 = 1_700_000_040;

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
  await seedToken({ address: T, name: "T", ticker: "T" });
});
afterAll(() => prisma.$disconnect());

describe("GET /:chain/tokens/:address/candles", () => {
  it("returns candles as strings inside items", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, vq: 20n, quoteAmount: 5n, timestamp: T0 });
    const res = await get(`/sepolia/tokens/${T}/candles?interval=60`);
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ time: T0, volume: "5" });
    expect(items[0].open).toBeTypeOf("string");
  });

  it("uses 60 seconds when the interval is missing or junk, and one second when it is below one", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, timestamp: T0 });
    await seedTrade({ token: T, blockNumber: 2, logIndex: 0, timestamp: T0 + 1 });
    const times = async (q: string) => (await (await get(`/sepolia/tokens/${T}/candles${q}`)).json()).items.map((c: { time: number }) => c.time);
    expect(await times("")).toEqual([T0]);
    expect(await times("?interval=abc")).toEqual([T0]);
    expect(await times("?interval=0")).toEqual([T0, T0 + 1]);
    expect(await times("?interval=-30")).toEqual([T0, T0 + 1]);
  });

  it("caps the interval at one week", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, timestamp: T0 });
    const { items } = await (await get(`/sepolia/tokens/${T}/candles?interval=999999999999`)).json();
    expect(items).toHaveLength(1);
    expect(items[0].time).toBe(Math.floor(T0 / 604_800) * 604_800);
  });

  it("treats a junk `from` as the start of time", async () => {
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0, timestamp: T0 });
    expect((await (await get(`/sepolia/tokens/${T}/candles?from=abc`)).json()).items).toHaveLength(1);
  });

  it("is 404 for an unknown token and for a hidden one", async () => {
    expect((await get(`/sepolia/tokens/${addr(0x99)}/candles`)).status).toBe(404);
    await prisma.tokenMetadata.create({ data: { chainId: 11155111, token: T, uri: "ipfs://x", status: "hidden" } });
    expect((await get(`/sepolia/tokens/${T}/candles`)).status).toBe(404);
  });

  it("returns an empty list, not an error, for a token with no trades yet", async () => {
    const res = await get(`/sepolia/tokens/${T}/candles`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });
});
