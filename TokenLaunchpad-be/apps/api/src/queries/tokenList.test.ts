import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedToken } from "../../test/seed.js";
import { BadCursorError, listTokens } from "./tokenList.js";

const CHAIN = 11155111;
const list = (o: Partial<Parameters<typeof listTokens>[0]> = {}) => listTokens({ chainId: CHAIN, sort: "new", limit: 10, ...o });

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

describe("listTokens: what appears", () => {
  // Review Focus 2: a token created seconds ago has no metadata row at all.
  it("includes a token with no metadata row, using its on-chain name", async () => {
    await seedToken({ address: "0xa1", name: "Fresh", ticker: "FRSH", volumeQuote: 10n });
    const { items } = await list();
    expect(items.map((t) => t.address)).toContain("0xa1");
    expect(items.find((t) => t.address === "0xa1")!.name).toBe("Fresh");
  });

  // Review Focus 1: metadata that failed to resolve must not remove the token.
  it("includes a token whose metadata is invalid, with no image and its on-chain name", async () => {
    await seedToken({ address: "0xa2", name: "Broken", ticker: "BRK" });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: "0xa2", uri: "ipfs://x", status: "invalid" } });
    const row = (await list()).items.find((t) => t.address === "0xa2");
    expect(row).toBeDefined();
    expect(row!.imageUrl).toBeUndefined();
    expect(row!.name).toBe("Broken");
  });

  it("excludes a hidden token", async () => {
    await seedToken({ address: "0xa3", name: "Spam", ticker: "SPAM" });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: "0xa3", uri: "ipfs://x", status: "hidden" } });
    expect((await list()).items.map((t) => t.address)).not.toContain("0xa3");
  });

  it("prefers the resolved metadata name and image over the on-chain ones", async () => {
    await seedToken({ address: "0xa4", name: "OnChain", ticker: "OC" });
    await prisma.tokenMetadata.create({
      data: { chainId: CHAIN, token: "0xa4", uri: "ipfs://x", status: "ok", name: "Resolved", description: "About it", imageCdnUrl: "https://cdn/x.png" },
    });
    const row = (await list()).items.find((t) => t.address === "0xa4")!;
    expect(row).toMatchObject({ name: "Resolved", description: "About it", imageUrl: "https://cdn/x.png" });
  });

  // A pending row can hold partial or hostile data; only a row that passed validation may speak.
  it("ignores the fields of metadata that is not yet ok", async () => {
    await seedToken({ address: "0xa5", name: "OnChain", ticker: "OC" });
    await prisma.tokenMetadata.create({
      data: { chainId: CHAIN, token: "0xa5", uri: "ipfs://x", status: "pending", name: "Draft", imageCdnUrl: "https://cdn/draft.png" },
    });
    const row = (await list()).items.find((t) => t.address === "0xa5")!;
    expect(row.name).toBe("OnChain");
    expect(row.imageUrl).toBeUndefined();
  });

  it("scopes by chain", async () => {
    await seedToken({ address: "0xd1", name: "Other", ticker: "OTH", chainId: 84532 });
    expect((await list()).items.map((t) => t.address)).not.toContain("0xd1");
  });

  it("returns amounts as bigint so no caller ever sees a money string", async () => {
    await seedToken({ address: "0xa6", name: "Big", ticker: "BIG", volumeQuote: 10n ** 27n });
    const row = (await list()).items.find((t) => t.address === "0xa6")!;
    expect(row.volumeQuote).toBe(10n ** 27n);
    expect(typeof row.createdAt).toBe("bigint");
  });
});

describe("listTokens: order and pagination", () => {
  it("orders by each sort key, largest first", async () => {
    await seedToken({ address: "0xb1", name: "A", ticker: "A", volumeQuote: 5n, progressBps: 9000, createdAt: 100 });
    await seedToken({ address: "0xb2", name: "B", ticker: "B", volumeQuote: 50n, progressBps: 100, createdAt: 300 });
    await seedToken({ address: "0xb3", name: "C", ticker: "C", volumeQuote: 20n, progressBps: 5000, createdAt: 200 });
    expect((await list({ sort: "volume" })).items.map((t) => t.address)).toEqual(["0xb2", "0xb3", "0xb1"]);
    expect((await list({ sort: "progress" })).items.map((t) => t.address)).toEqual(["0xb1", "0xb3", "0xb2"]);
    expect((await list({ sort: "new" })).items.map((t) => t.address)).toEqual(["0xb2", "0xb3", "0xb1"]);
  });

  // Review Focus 5: ties on the sort column must not repeat or skip under pagination.
  it("paginates without repeats or gaps when every token has the same volume", async () => {
    for (let i = 0; i < 25; i++) {
      await seedToken({ address: `0xc${i.toString().padStart(2, "0")}`, name: `T${i}`, ticker: "T", volumeQuote: 7n });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await list({ sort: "volume", limit: 10, cursor });
      for (const t of res.items) {
        expect(seen, `${t.address} repeated on page ${page}`).not.toContain(t.address);
        seen.push(t.address);
      }
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(25);
  });

  it("returns no cursor on the last page", async () => {
    await seedToken({ address: "0xe1", name: "Only", ticker: "ONE" });
    expect((await list()).nextCursor).toBeUndefined();
  });

  it("returns no cursor when the page is exactly full and nothing follows", async () => {
    for (let i = 0; i < 3; i++) await seedToken({ address: `0xf${i}`, name: `T${i}`, ticker: "T", volumeQuote: BigInt(i) });
    expect((await list({ sort: "volume", limit: 3 })).nextCursor).toBeUndefined();
  });

  // Review Focus 5: the cursor is a value, not a row id, so removing the row it points at changes nothing.
  it("keeps paginating correctly when the row the cursor points at is hidden meanwhile", async () => {
    for (let i = 0; i < 6; i++) await seedToken({ address: `0x1${i}`, name: `T${i}`, ticker: "T", volumeQuote: BigInt(100 - i) });
    const first = await list({ sort: "volume", limit: 3 });
    const lastOfFirst = first.items.at(-1)!.address;
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: lastOfFirst, uri: "ipfs://x", status: "hidden" } });
    const second = await list({ sort: "volume", limit: 3, cursor: first.nextCursor });
    expect(second.items.map((t) => t.address)).toEqual(["0x13", "0x14", "0x15"]);
  });

  it("rejects a malformed cursor with a typed error rather than a SQL error", async () => {
    await expect(list({ cursor: "not a cursor!!" })).rejects.toBeInstanceOf(BadCursorError);
    const wrongShape = Buffer.from(JSON.stringify({ a: 1 })).toString("base64url");
    await expect(list({ cursor: wrongShape })).rejects.toBeInstanceOf(BadCursorError);
    const injection = Buffer.from(JSON.stringify(["1; drop table launchpad.token", "0xa"])).toString("base64url");
    await expect(list({ cursor: injection })).rejects.toBeInstanceOf(BadCursorError);
  });
});
