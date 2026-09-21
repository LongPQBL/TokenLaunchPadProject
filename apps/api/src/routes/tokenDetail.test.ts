import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedBalance, seedToken, seedTrade } from "../../test/seed.js";
import { createApp } from "../app.js";

const LAUNCHPAD = addr(0x1a);
const app = createApp({ corsOrigins: [], ready: async () => true, launchpads: { 11155111: LAUNCHPAD } });
const get = (path: string) => app.request(path);
const T = addr(0xabc);

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

const hide = (token: string) => prisma.tokenMetadata.create({ data: { chainId: 11155111, token, uri: "ipfs://x", status: "hidden" } });

describe("GET /:chain/tokens/:address", () => {
  it("returns the token with every amount as a decimal string", async () => {
    await seedToken({ address: T, name: "Detail", ticker: "DTL", virtualQuoteReserves: 10n ** 27n, pair: addr(0x9a) });
    const res = await get(`/sepolia/tokens/${T}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      address: T, name: "Detail", virtualQuoteReserves: "1000000000000000000000000000", metadataStatus: "pending", socials: {},
    });
  });

  it("accepts a checksummed or upper-case address and answers with the lower-case one", async () => {
    await seedToken({ address: T, name: "Case", ticker: "CS" });
    const res = await get(`/sepolia/tokens/${T.toUpperCase().replace("0X", "0x")}`);
    expect(res.status).toBe(200);
    expect((await res.json()).address).toBe(T);
  });

  it("is 404 not_found for a well-formed address the indexer has not seen", async () => {
    const res = await get(`/sepolia/tokens/${addr(0x99)}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("is 400 bad_address for anything that is not a 40-digit hex address", async () => {
    for (const bad of ["0xa1", "not-an-address", `0x${"z".repeat(40)}`, `${T}00`]) {
      const res = await get(`/sepolia/tokens/${bad}`);
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error, bad).toBe("bad_address");
    }
  });

  // Review Focus 1: a hidden token must disappear everywhere, including from a direct link.
  it("is 404 for a hidden token, on the detail, trades and holders endpoints alike", async () => {
    await seedToken({ address: T, name: "Spam", ticker: "SPM" });
    await seedTrade({ token: T, blockNumber: 1, logIndex: 0 });
    await seedBalance({ token: T, holder: addr(1), amount: 5n });
    await hide(T);
    for (const path of [`/sepolia/tokens/${T}`, `/sepolia/tokens/${T}/trades`, `/sepolia/tokens/${T}/holders`]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect((await res.json()).error, path).toBe("not_found");
    }
  });
});

describe("GET /:chain/tokens/:address/trades", () => {
  it("returns trades newest first with amounts as strings, and a cursor to the rest", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    for (let i = 0; i < 5; i++) await seedTrade({ token: T, blockNumber: 100 + i, logIndex: 0, quoteAmount: 10n ** 24n });
    const first = await (await get(`/sepolia/tokens/${T}/trades?limit=3`)).json();
    expect(first.items).toHaveLength(3);
    expect(first.items[0]).toMatchObject({ blockNumber: "104", quoteAmount: "1000000000000000000000000" });
    const second = await (await get(`/sepolia/tokens/${T}/trades?limit=3&cursor=${first.nextCursor}`)).json();
    expect(second.items.map((t: { blockNumber: string }) => t.blockNumber)).toEqual(["101", "100"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("is 404 for an unknown token rather than an empty list that hides a typo", async () => {
    expect((await get(`/sepolia/tokens/${addr(0x99)}/trades`)).status).toBe(404);
  });

  it("rejects a malformed cursor with 400 bad_cursor", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    const res = await get(`/sepolia/tokens/${T}/trades?cursor=zzz`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_cursor");
  });

  it("caps the page size at 200", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    for (let i = 0; i < 205; i++) await seedTrade({ token: T, blockNumber: i, logIndex: 0 });
    expect((await (await get(`/sepolia/tokens/${T}/trades?limit=100000`)).json()).items).toHaveLength(200);
  });
});

describe("GET /:chain/tokens/:address/holders", () => {
  it("lists holders by balance and leaves out the launchpad the app was configured with", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    await seedBalance({ token: T, holder: LAUNCHPAD, amount: 10n ** 27n });
    await seedBalance({ token: T, holder: addr(1), amount: 20n });
    await seedBalance({ token: T, holder: addr(2), amount: 40n });
    const body = await (await get(`/sepolia/tokens/${T}/holders`)).json();
    expect(body.items).toEqual([{ holder: addr(2), amount: "40" }, { holder: addr(1), amount: "20" }]);
  });

  it("is 404 for an unknown token", async () => {
    expect((await get(`/sepolia/tokens/${addr(0x99)}/holders`)).status).toBe(404);
  });
});
