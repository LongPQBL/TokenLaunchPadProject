import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";
import { resetAppData } from "../../test/app-data.js";

const app = createApp({});
const get = (path: string) => app.request(path);
const T = addr(0x77);
const ME = addr(0xa1);

beforeEach(async () => {
  await resetAppData();
  await seedToken.reset();
  await seedToken({ address: T, name: "Demo", ticker: "DEMO" });
  await prisma.appUser.create({ data: { address: ME, username: "alice" } });
});
afterAll(() => prisma.$disconnect());

describe("GET /:chain/tokens/:address/comments", () => {
  it("lists a token's comments, newest first, with the times as decimal strings", async () => {
    await prisma.comment.create({ data: { chainId: 11155111, token: T, author: ME, body: "one" } });
    await prisma.comment.create({ data: { chainId: 11155111, token: T, author: ME, body: "two" } });
    const res = await get(`/sepolia/tokens/${T}/comments`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { body: string; createdAt: string; username: string }[] };
    expect(items.map((c) => c.body)).toEqual(["two", "one"]);
    expect(items[0]!.username).toBe("alice");
    expect(items[0]!.createdAt).toMatch(/^\d+$/);
  });

  it("is an empty list for a token nobody has commented on", async () => {
    expect(await (await get(`/sepolia/tokens/${T}/comments`)).json()).toEqual({ items: [] });
  });

  it("is the same 404 as the token itself for a hidden token, so a hidden token's thread cannot be reached by its address", async () => {
    await prisma.comment.create({ data: { chainId: 11155111, token: T, author: ME, body: "still here in the table" } });
    await prisma.tokenMetadata.create({ data: { chainId: 11155111, token: T, uri: "ipfs://x", status: "hidden" } });
    const res = await get(`/sepolia/tokens/${T}/comments`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_found");
  });

  it("follows the cursor and rejects a malformed one as a bad request", async () => {
    for (let i = 1; i <= 3; i++) await prisma.comment.create({ data: { chainId: 11155111, token: T, author: ME, body: `c${i}` } });
    const first = (await (await get(`/sepolia/tokens/${T}/comments?limit=2`)).json()) as { items: { body: string }[]; nextCursor: string };
    expect(first.items.map((c) => c.body)).toEqual(["c3", "c2"]);
    const second = (await (await get(`/sepolia/tokens/${T}/comments?limit=2&cursor=${first.nextCursor}`)).json()) as { items: { body: string }[] };
    expect(second.items.map((c) => c.body)).toEqual(["c1"]);
    const bad = await get(`/sepolia/tokens/${T}/comments?cursor=zzz`);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("bad_cursor");
  });
});
