import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";

const app = createApp({ corsOrigins: [], ready: async () => true });
const get = (path: string) => app.request(path);

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

describe("GET /:chain/tokens", () => {
  it("returns items with every amount as a decimal string", async () => {
    await seedToken({ address: "0xa1", name: "Big", ticker: "BIG", volumeQuote: 10n ** 27n, createdAt: 1_700_000_000 });
    const res = await get("/sepolia/tokens");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ address: "0xa1", name: "Big", volumeQuote: "1000000000000000000000000000", createdAt: "1700000000" });
    expect(body.nextCursor).toBeUndefined();
  });

  it("defaults to newest first", async () => {
    await seedToken({ address: "0xa1", name: "Old", ticker: "O", createdAt: 100 });
    await seedToken({ address: "0xa2", name: "New", ticker: "N", createdAt: 200 });
    const body = await (await get("/sepolia/tokens")).json();
    expect(body.items.map((t: { address: string }) => t.address)).toEqual(["0xa2", "0xa1"]);
  });

  it("does not serve a hidden token", async () => {
    await seedToken({ address: "0xa3", name: "Spam", ticker: "S" });
    await prisma.tokenMetadata.create({ data: { chainId: 11155111, token: "0xa3", uri: "ipfs://x", status: "hidden" } });
    expect((await (await get("/sepolia/tokens")).json()).items).toHaveLength(0);
  });

  it("follows nextCursor to the next page", async () => {
    for (let i = 0; i < 5; i++) await seedToken({ address: `0xb${i}`, name: `T${i}`, ticker: "T", createdAt: 100 + i });
    const first = await (await get("/sepolia/tokens?limit=3")).json();
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = await (await get(`/sepolia/tokens?limit=3&cursor=${first.nextCursor}`)).json();
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeUndefined();
  });

  it("rejects an unknown sort with a machine-readable error, not a 500", async () => {
    const res = await get("/sepolia/tokens?sort=price;drop%20table");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_sort");
  });

  it("rejects a malformed cursor with a machine-readable error", async () => {
    const res = await get("/sepolia/tokens?cursor=zzz");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_cursor");
  });

  it("treats a non-numeric or non-positive limit as a default or a minimum, never an error", async () => {
    for (let i = 0; i < 3; i++) await seedToken({ address: `0xc${i}`, name: `T${i}`, ticker: "T" });
    expect((await (await get("/sepolia/tokens?limit=abc")).json()).items).toHaveLength(3);
    expect((await (await get("/sepolia/tokens?limit=0")).json()).items).toHaveLength(1);
    expect((await (await get("/sepolia/tokens?limit=-5")).json()).items).toHaveLength(1);
  });

  it("caps the limit at 100", async () => {
    for (let i = 0; i < 105; i++) await seedToken({ address: `0xd${i.toString().padStart(3, "0")}`, name: `T${i}`, ticker: "T" });
    expect((await (await get("/sepolia/tokens?limit=100000")).json()).items).toHaveLength(100);
  });

  it("filters by q, and a percent sign in q is not a wildcard", async () => {
    await seedToken({ address: "0xe1", name: "Fresh Mint", ticker: "FRSH" });
    await seedToken({ address: "0xe2", name: "Other", ticker: "OTH" });
    const hit = await (await get("/sepolia/tokens?q=fresh")).json();
    expect(hit.items.map((t: { address: string }) => t.address)).toEqual(["0xe1"]);
    const wildcard = await (await get("/sepolia/tokens?q=%25")).json();
    expect(wildcard.items).toEqual([]);
  });

  it("still refuses an unknown chain", async () => {
    expect((await get("/mainnet/tokens")).status).toBe(404);
  });
});
