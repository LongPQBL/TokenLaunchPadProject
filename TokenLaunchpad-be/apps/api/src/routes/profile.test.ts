import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetAppData } from "../../test/app-data.js";
import { addr, seedBalance, seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";
import { getSql } from "../db.js";

const app = createApp({});
const ME = addr(0xa1);

beforeEach(async () => {
  await resetAppData();
  await seedToken.reset();
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

const get = (address: string, chain = "sepolia") => app.request(`/${chain}/addresses/${address}/profile`);

describe("GET /:chain/addresses/:address/profile", () => {
  it("serves what an address created and holds, with amounts and times as decimal strings", async () => {
    await seedToken({ address: addr(0x1), creator: ME, name: "Mine", ticker: "MINE", createdAt: 100 });
    await seedToken({ address: addr(0x2), creator: addr(0xa2), name: "Theirs", ticker: "THEM" });
    await seedBalance({ token: addr(0x2), holder: ME, amount: 7n });
    const res = await get(ME);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: { address: string; createdAt: string }[]; holdings: { token: { address: string }; amount: string }[] };
    expect(body.created.map((t) => t.address)).toEqual([addr(0x1)]);
    expect(body.created[0]!.createdAt).toBe("100");
    expect(body.holdings.map((h) => [h.token.address, h.amount])).toEqual([[addr(0x2), "7"]]);
  });

  it("is an empty profile, not an error, for an address that never used the launchpad", async () => {
    const res = await get(addr(0x99));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: [], holdings: [] });
  });

  it("takes an address in any case", async () => {
    await seedToken({ address: addr(0x1), creator: ME, name: "Mine", ticker: "MINE" });
    const upper = `0x${ME.slice(2).toUpperCase()}`;
    expect(((await (await get(upper)).json()) as { created: unknown[] }).created).toHaveLength(1);
  });

  it("names the person, when they have set a name and a picture", async () => {
    await prisma.appUser.create({ data: { address: ME, username: "alice" } });
    const body = (await (await get(ME)).json()) as { user?: { username?: string } };
    expect(body.user).toEqual({ username: "alice" });
  });

  it("says nothing of a user for an address with no account, or one without a name", async () => {
    expect(((await (await get(ME)).json()) as { user?: unknown }).user).toBeUndefined();
    await prisma.appUser.create({ data: { address: ME } });
    expect(((await (await get(ME)).json()) as { user?: unknown }).user).toBeUndefined();
  });

  it("does not show a banned person's name", async () => {
    await prisma.appUser.create({ data: { address: ME, username: "spammer", bannedAt: new Date() } });
    expect(((await (await get(ME)).json()) as { user?: unknown }).user).toBeUndefined();
  });

  it("refuses what is not an address, and an unknown chain", async () => {
    expect((await get("nobody")).status).toBe(400);
    expect((await get(ME, "nochain")).status).toBe(404);
  });
});
