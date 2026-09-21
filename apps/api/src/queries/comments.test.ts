import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr } from "../../test/seed.js";
import { BadCommentCursorError, listComments } from "./comments.js";
import { resetAppData } from "../../test/app-data.js";

const SEPOLIA = 11155111;
const GATEWAY = "https://gateway.test";
const T = addr(0x77);
const ME = addr(0xa1);
const YOU = addr(0xa2);

beforeEach(async () => {
  await resetAppData();
  await prisma.appUser.createMany({ data: [{ address: ME, username: "alice" }, { address: YOU }] });
});
afterAll(() => prisma.$disconnect());

const say = (body: string, o: { author?: string; token?: string; chainId?: number; hidden?: boolean } = {}) =>
  prisma.comment.create({ data: { chainId: o.chainId ?? SEPOLIA, token: o.token ?? T, author: o.author ?? ME, body, hidden: o.hidden ?? false } });
const list = (o: { cursor?: string; limit?: number; token?: string; chainId?: number } = {}) =>
  listComments(o.chainId ?? SEPOLIA, o.token ?? T, { cursor: o.cursor, limit: o.limit ?? 50, gateway: GATEWAY });

describe("listComments", () => {
  it("returns the newest first, each with its author, username and body", async () => {
    await say("first");
    await say("second", { author: YOU });
    const { items } = await list();
    expect(items.map((c) => c.body)).toEqual(["second", "first"]);
    expect(items[1]).toMatchObject({ author: ME, username: "alice", body: "first" });
    expect(typeof items[0]!.id).toBe("string");
    expect(typeof items[0]!.createdAt).toBe("bigint");
  });

  it("pages with a cursor and never repeats or skips a comment", async () => {
    for (let i = 1; i <= 7; i++) await say(`c${i}`);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 3, cursor });
      seen.push(...page.items.map((c) => c.body));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["c7", "c6", "c5", "c4", "c3", "c2", "c1"]);
  });

  it("gives no cursor on the last page", async () => {
    await say("only");
    expect((await list({ limit: 5 })).nextCursor).toBeUndefined();
  });

  it("does not serve a hidden comment", async () => {
    await say("visible");
    await say("removed", { hidden: true });
    expect((await list()).items.map((c) => c.body)).toEqual(["visible"]);
  });

  it("does not serve anything written by a banned author, but keeps the rows", async () => {
    await say("from a good user", { author: YOU });
    await say("from a banned user");
    await prisma.appUser.update({ where: { address: ME }, data: { bannedAt: new Date() } });
    expect((await list()).items.map((c) => c.body)).toEqual(["from a good user"]);
    expect(await prisma.comment.count()).toBe(2);
  });

  it("does not serve the comments of a hidden token, keeping them for whoever needs them later", async () => {
    await say("on a token that was hidden");
    await prisma.tokenMetadata.create({ data: { chainId: SEPOLIA, token: T, uri: "ipfs://x", status: "hidden" } });
    expect((await list()).items).toEqual([]);
    expect(await prisma.comment.count()).toBe(1);
  });

  it("serves them again when the token is un-hidden", async () => {
    await say("back again");
    await prisma.tokenMetadata.create({ data: { chainId: SEPOLIA, token: T, uri: "ipfs://x", status: "hidden" } });
    await prisma.tokenMetadata.update({ where: { chainId_token: { chainId: SEPOLIA, token: T } }, data: { status: "ok" } });
    expect((await list()).items).toHaveLength(1);
  });

  it("leaves the username out when the author has none: the client shows the shortened address", async () => {
    await say("anon", { author: YOU });
    const [c] = (await list()).items;
    expect(c!.username).toBeUndefined();
  });

  it("turns an avatar reference into a gateway URL, and never into anything else", async () => {
    await prisma.appUser.update({ where: { address: ME }, data: { avatarUri: "ipfs://bafyabcde" } });
    await prisma.appUser.update({ where: { address: YOU }, data: { avatarUri: "javascript:alert(1)" } });
    await say("mine");
    await say("yours", { author: YOU });
    const byBody = Object.fromEntries((await list()).items.map((c) => [c.body, c.avatarUrl]));
    expect(byBody.mine).toBe(`${GATEWAY}/ipfs/bafyabcde`);
    expect(byBody.yours).toBeUndefined();
  });

  it("is scoped to one token on one chain", async () => {
    await say("here");
    await say("other token", { token: addr(0x78) });
    await say("other chain", { chainId: 1 });
    expect((await list()).items.map((c) => c.body)).toEqual(["here"]);
  });

  it("returns an empty list, not an error, for a token nobody has commented on or the indexer has never seen", async () => {
    expect(await list({ token: addr(0x99) })).toEqual({ items: [] });
  });

  it("returns what was written, byte for byte: escaping is the renderer's job", async () => {
    await say("<script>alert(1)</script> ‮evil");
    expect((await list()).items[0]!.body).toBe("<script>alert(1)</script> ‮evil");
  });

  it("clamps the page size to something sensible", async () => {
    await prisma.comment.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ chainId: SEPOLIA, token: T, author: ME, body: `c${i}` })) });
    expect((await list({ limit: 0 })).items).toHaveLength(1);
    expect((await list({ limit: -3 })).items).toHaveLength(1);
    expect((await list({ limit: 100_000 })).items).toHaveLength(100);
  });

  it("refuses a malformed cursor", async () => {
    for (const bad of ["zzz", Buffer.from("[]").toString("base64url"), Buffer.from('["1; drop table x"]').toString("base64url"), Buffer.from('[99999999999999999999999]').toString("base64url")]) {
      await expect(list({ cursor: bad }), bad).rejects.toBeInstanceOf(BadCommentCursorError);
    }
  });
});
