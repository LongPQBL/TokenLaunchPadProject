import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedToken } from "../../test/seed.js";
import { listTokens } from "./tokenList.js";

const CHAIN = 11155111;
const search = (q: string, o: Partial<Parameters<typeof listTokens>[0]> = {}) =>
  listTokens({ chainId: CHAIN, sort: "new", limit: 20, q, ...o });
const addresses = async (q: string) => (await search(q)).items.map((t) => t.address);

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

describe("token search: what matches", () => {
  it("finds a token by its resolved metadata name", async () => {
    await seedToken({ address: "0xe1", name: "OnChain", ticker: "OC" });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: "0xe1", uri: "ipfs://x", status: "ok", name: "Dogecoin Killer" } });
    expect(await addresses("dogecoin")).toContain("0xe1");
  });

  // Review Focus 2 again: a brand-new token has no metadata row, and must still be findable.
  it("finds a token with no metadata row by its on-chain name and by its ticker", async () => {
    await seedToken({ address: "0xe2", name: "Fresh Mint", ticker: "FRSH" });
    expect(await addresses("fresh")).toContain("0xe2");
    expect(await addresses("FRSH")).toContain("0xe2");
  });

  it("is case-insensitive and matches on a fragment", async () => {
    await seedToken({ address: "0xe3", name: "Supercalifragilistic", ticker: "SUP" });
    expect(await addresses("CALIFRAG")).toContain("0xe3");
  });

  it("treats a full address as a direct lookup, whatever its case", async () => {
    const addr = "0x8509aea46cef52be7cc3d07b3f2a4c4f08ae7744";
    await seedToken({ address: addr, name: "ByAddress", ticker: "ADDR" });
    await seedToken({ address: "0x0000000000000000000000000000000000000001", name: "Other", ticker: "OTH" });
    const { items } = await search(addr.toUpperCase().replace("0X", "0x"));
    expect(items.map((t) => t.address)).toEqual([addr]);
  });

  it("returns nothing for an address that is well-formed but unknown", async () => {
    await seedToken({ address: "0xe4", name: "Anything", ticker: "ANY" });
    expect(await addresses("0x" + "9".repeat(40))).toEqual([]);
  });

  it("still excludes hidden tokens", async () => {
    await seedToken({ address: "0xe5", name: "Hidden Thing", ticker: "HID" });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: "0xe5", uri: "ipfs://x", status: "hidden" } });
    expect(await addresses("hidden")).toEqual([]);
  });

  it("returns nothing, not everything, for an unmatched query", async () => {
    await seedToken({ address: "0xe6", name: "Alpha", ticker: "ALP" });
    expect(await addresses("zzzzzz")).toEqual([]);
  });

  // Only validated metadata may speak: a pending row's name is unverified, possibly hostile, data.
  it("does not match on the name of metadata that is not yet ok", async () => {
    await seedToken({ address: "0xe7", name: "Plain", ticker: "PLN" });
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN, token: "0xe7", uri: "ipfs://x", status: "pending", name: "Sneaky" } });
    expect(await addresses("sneaky")).toEqual([]);
    expect(await addresses("plain")).toContain("0xe7");
  });

  it("scopes the search to the chain", async () => {
    await seedToken({ address: "0xe8", name: "Shared Name", ticker: "SHR", chainId: 84532 });
    expect(await addresses("shared")).toEqual([]);
  });
});

describe("token search: hostile and awkward input", () => {
  it("does not break on SQL metacharacters and matches them literally", async () => {
    await seedToken({ address: "0xf1", name: "Normal", ticker: "NRM" });
    await expect(search("100% ' or 1=1 --")).resolves.toEqual({ items: [] });
    await expect(search("'; drop table launchpad.token; --")).resolves.toEqual({ items: [] });
    expect(await addresses("normal")).toContain("0xf1"); // the table is still there
  });

  // In LIKE, % and _ are wildcards. Typed by a user they must be plain characters, or "%" lists everything.
  it("treats % and _ as literal characters, not wildcards", async () => {
    await seedToken({ address: "0xf2", name: "Plain", ticker: "PLN" });
    await seedToken({ address: "0xf3", name: "50% Off_Deal", ticker: "OFF" });
    expect(await addresses("%")).toEqual(["0xf3"]);
    expect(await addresses("_")).toEqual(["0xf3"]);
    expect(await addresses("50% off_")).toEqual(["0xf3"]);
    expect(await addresses("p_ain")).toEqual([]); // "_" must not stand in for the "l"
  });

  it("treats a blank query as no search at all", async () => {
    await seedToken({ address: "0xf4", name: "One", ticker: "ONE" });
    expect(await addresses("   ")).toContain("0xf4");
    expect(await addresses("")).toContain("0xf4");
  });

  it("copes with a very long query without erroring", async () => {
    await seedToken({ address: "0xf5", name: "One", ticker: "ONE" });
    await expect(search("a".repeat(10_000))).resolves.toEqual({ items: [] });
  });

  it("does not treat a 42-character non-hex string as an address", async () => {
    await seedToken({ address: "0xf6", name: "Real", ticker: "RL" });
    await expect(search("0x" + "z".repeat(40))).resolves.toEqual({ items: [] });
  });
});

describe("token search: pagination", () => {
  it("paginates within a search without repeats or gaps", async () => {
    for (let i = 0; i < 12; i++) await seedToken({ address: `0xa${i.toString(16)}`, name: `Match ${i}`, ticker: "MTC", volumeQuote: 7n });
    await seedToken({ address: "0xb0", name: "Other", ticker: "OTH", volumeQuote: 7n });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const res = await search("match", { sort: "volume", limit: 5, cursor });
      seen.push(...res.items.map((t) => t.address));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(12);
    expect(seen).toHaveLength(12);
    expect(seen).not.toContain("0xb0");
  });
});
