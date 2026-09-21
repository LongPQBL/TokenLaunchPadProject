import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedBalance, seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";

const app = createApp({});
const get = (path: string) => app.request(path);
const ME = addr(0xabc);

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

describe("GET /:chain/addresses/:address/holdings", () => {
  it("lists every token an address holds, with the amount as a decimal string", async () => {
    await seedToken({ address: addr(1) });
    await seedToken({ address: addr(2) });
    await seedBalance({ token: addr(1), holder: ME, amount: 5n * 10n ** 18n });
    await seedBalance({ token: addr(2), holder: ME, amount: 10n ** 27n });
    const res = await get(`/sepolia/addresses/${ME}/holdings`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { token: string; amount: string }[] };
    expect(items).toHaveLength(2);
    expect(Object.fromEntries(items.map((i) => [i.token, i.amount]))).toEqual({ [addr(1)]: "5000000000000000000", [addr(2)]: "1000000000000000000000000000" });
  });

  it("leaves out zero balances, other people's balances and other chains", async () => {
    await seedToken({ address: addr(1) });
    await seedBalance({ token: addr(1), holder: ME, amount: 0n });
    await seedBalance({ token: addr(1), holder: addr(0xdef), amount: 7n });
    await seedBalance({ token: addr(1), holder: ME, amount: 9n, chainId: 1 });
    const { items } = (await (await get(`/sepolia/addresses/${ME}/holdings`)).json()) as { items: unknown[] };
    expect(items).toEqual([]);
  });

  // Moderation hides a token from the lists. It must never make someone's money unreachable.
  it("still lists a token that has been hidden: a person must be able to withdraw what they hold", async () => {
    await seedToken({ address: addr(1) });
    await prisma.tokenMetadata.create({ data: { chainId: 11155111, token: addr(1), uri: "ipfs://x", status: "hidden" } });
    await seedBalance({ token: addr(1), holder: ME, amount: 3n });
    const { items } = (await (await get(`/sepolia/addresses/${ME}/holdings`)).json()) as { items: { token: string }[] };
    expect(items.map((i) => i.token)).toEqual([addr(1)]);
  });

  it("matches the address whatever its capitalisation", async () => {
    await seedToken({ address: addr(1) });
    await seedBalance({ token: addr(1), holder: ME, amount: 3n });
    const upper = `0x${ME.slice(2).toUpperCase()}`;
    const { items } = (await (await get(`/sepolia/addresses/${upper}/holdings`)).json()) as { items: unknown[] };
    expect(items).toHaveLength(1);
  });

  it("is a 400 for something that is not an address", async () => {
    for (const bad of ["0x123", "javascript:alert(1)", "zzz"]) expect((await get(`/sepolia/addresses/${encodeURIComponent(bad)}/holdings`)).status).toBe(400);
  });

  it("never returns more than 200 tokens", async () => {
    for (let i = 1; i <= 205; i++) {
      await seedToken({ address: addr(i) });
      await seedBalance({ token: addr(i), holder: ME, amount: BigInt(i) });
    }
    const { items } = (await (await get(`/sepolia/addresses/${ME}/holdings`)).json()) as { items: unknown[] };
    expect(items).toHaveLength(200);
  });
});
