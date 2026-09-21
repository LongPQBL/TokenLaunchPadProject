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
  // Addresses of their own, and only their own users are cleared: other test files run in parallel against this database and have users
  // with comments, which a blanket delete would run into (the comment's foreign key).
  const A = addr(0x7a11);
  const B = addr(0x7a12);
  const holders = async () => (await (await get(`/sepolia/tokens/${T}/holders`)).json()).items as Record<string, unknown>[];

  beforeEach(async () => {
    await prisma.appUser.deleteMany({ where: { address: { in: [A, B] } } });
  });

  it("lists holders by balance and leaves out the launchpad the app was configured with", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    await seedBalance({ token: T, holder: LAUNCHPAD, amount: 10n ** 27n });
    await seedBalance({ token: T, holder: A, amount: 20n });
    await seedBalance({ token: T, holder: B, amount: 40n });
    const items = await holders();
    expect(items.map((i) => [i.holder, i.amount])).toEqual([[B, "40"], [A, "20"]]);
  });

  // The same figures as an address's positions: what its tokens are worth at the price the curve is at now, and value + received - spent.
  it("says what each holder's tokens are worth now and what they have made: the value at the current price, plus what was sold, less what was bought", async () => {
    await seedToken({ address: T, name: "T", ticker: "T", virtualQuoteReserves: 200n, virtualTokenReserves: 1_000n }); // 0.2 quote per token
    await seedBalance({ token: T, holder: A, amount: 100n });
    await seedBalance({ token: T, holder: B, amount: 50n }); // came by transfer: nothing bought on the curve
    await seedTrade({ token: T, trader: A, isBuy: true, quoteAmount: 10n, fee: 1n, blockNumber: 1, logIndex: 0 }); // cost 10 + 1
    await seedTrade({ token: T, trader: A, isBuy: false, quoteAmount: 5n, fee: 1n, blockNumber: 2, logIndex: 0 }); // paid out 5 - 1
    const [a, b] = await holders();
    expect(a).toMatchObject({ holder: A, amount: "100", value: "20", spent: "11", received: "4", pnl: "13" }); // 20 + 4 - 11
    expect(b).toMatchObject({ holder: B, amount: "50", value: "10", spent: "0", received: "0", pnl: "10" }); // the whole value: nothing was spent
  });

  it("shows a loss as a negative number", async () => {
    await seedToken({ address: T, name: "T", ticker: "T", virtualQuoteReserves: 100n, virtualTokenReserves: 1_000n }); // 0.1 quote per token
    await seedBalance({ token: T, holder: A, amount: 100n }); // worth 10
    await seedTrade({ token: T, trader: A, isBuy: true, quoteAmount: 40n, fee: 2n, blockNumber: 1, logIndex: 0 }); // cost 42
    expect((await holders())[0]).toMatchObject({ value: "10", spent: "42", pnl: "-32" });
  });

  it("counts only this token's trades, this chain's, and this holder's own", async () => {
    await seedToken({ address: T, name: "T", ticker: "T", virtualQuoteReserves: 100n, virtualTokenReserves: 1_000n });
    await seedToken({ address: addr(0xdef), name: "Other", ticker: "O" });
    await seedBalance({ token: T, holder: A, amount: 100n });
    await seedTrade({ token: addr(0xdef), trader: A, isBuy: true, quoteAmount: 999n, blockNumber: 1, logIndex: 0 }); // another token
    await seedTrade({ token: T, trader: B, isBuy: true, quoteAmount: 888n, blockNumber: 2, logIndex: 0 }); // another holder
    await seedTrade({ token: T, trader: A, isBuy: true, quoteAmount: 777n, blockNumber: 3, logIndex: 0, chainId: 84532 }); // another chain
    expect((await holders())[0]).toMatchObject({ spent: "0", received: "0", pnl: "10" });
  });

  it("values them at nothing, not an error, for a token with no reserves to price it", async () => {
    await seedToken({ address: T, name: "T", ticker: "T", virtualQuoteReserves: 0n, virtualTokenReserves: 0n });
    await seedBalance({ token: T, holder: A, amount: 100n });
    await seedTrade({ token: T, trader: A, isBuy: false, quoteAmount: 30n, fee: 0n, blockNumber: 1, logIndex: 0 });
    expect((await holders())[0]).toMatchObject({ value: "0", received: "30", pnl: "30" });
  });

  it("names a holder who has said who they are: their name, and their picture through the one gateway", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    await seedBalance({ token: T, holder: A, amount: 20n });
    await seedBalance({ token: T, holder: B, amount: 10n });
    await prisma.appUser.create({ data: { address: A, username: "octopus", avatarUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" } });
    const [a, b] = await holders();
    expect(a).toMatchObject({ username: "octopus", avatarUrl: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" });
    expect(b).not.toHaveProperty("username"); // nobody who has not said who they are gets a name
    expect(b).not.toHaveProperty("avatarUrl");
  });

  it("does not name a holder who has been banned, or put their picture up, but still counts what they hold", async () => {
    await seedToken({ address: T, name: "T", ticker: "T" });
    await seedBalance({ token: T, holder: A, amount: 20n });
    await prisma.appUser.create({ data: { address: A, username: "spammer", avatarUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", bannedAt: new Date() } });
    const [a] = await holders();
    expect(a).toMatchObject({ holder: A, amount: "20" });
    expect(a).not.toHaveProperty("username");
    expect(a).not.toHaveProperty("avatarUrl");
  });

  it("keeps the order by balance when names are added, and one holder is one row however many trades they made", async () => {
    await seedToken({ address: T, name: "T", ticker: "T", virtualQuoteReserves: 100n, virtualTokenReserves: 1_000n });
    await seedBalance({ token: T, holder: A, amount: 20n });
    await seedBalance({ token: T, holder: B, amount: 40n });
    for (let i = 0; i < 5; i++) await seedTrade({ token: T, trader: A, isBuy: true, quoteAmount: 1n, blockNumber: i, logIndex: 0 });
    await prisma.appUser.create({ data: { address: A, username: "aaa" } });
    expect((await holders()).map((i) => i.holder)).toEqual([B, A]);
  });

  it("is 404 for an unknown token", async () => {
    expect((await get(`/sepolia/tokens/${addr(0x99)}/holders`)).status).toBe(404);
  });
});
