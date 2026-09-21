import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../../test/auth.js";
import { addr, seedBalance, seedTrade, seedToken } from "../../../test/seed.js";
import { createApp } from "../../app.js";
import { getSql } from "../../db.js";
import type { ModerationEvent } from "../../realtime/moderation.js";
import { resetAppData } from "../../../test/app-data.js";

const admin = randomAccount();
const otherAdmin = randomAccount();
const told: ModerationEvent[] = [];
const app = createApp({
  auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN },
  adminAddresses: [admin.address, otherAdmin.address],
  publishModeration: async (event) => void told.push(event),
});
const SPAM = addr(0x51);
const GOOD = addr(0x52);
const CHAIN_ID = 11155111;

let adminCookie = "";
let otherAdminCookie = "";
let userCookie = "";
let userAddress = "";

async function session(account: ReturnType<typeof randomAccount>) {
  const signed = await signIn(app, account);
  expect(signed.cookie, "sign-in must give a session cookie").toMatch(/^vezta_session=/);
  return signed;
}

beforeEach(async () => {
  told.length = 0;
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
  await resetAppData();
  await seedToken.reset();
  await seedToken({ address: SPAM, name: "Spam Coin", ticker: "SPAM", metadataUri: "ipfs://spam" });
  await seedToken({ address: GOOD, name: "Good Coin", ticker: "GOOD", metadataUri: "ipfs://good" });
  adminCookie = (await session(admin)).cookie;
  otherAdminCookie = (await session(otherAdmin)).cookie;
  const user = await session(randomAccount());
  userCookie = user.cookie;
  userAddress = user.address;
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

const post = (path: string, cookie?: string, body: unknown = {}, contentType = "application/json") =>
  app.request(`/sepolia/admin${path}`, { method: "POST", headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const hide = (token = SPAM, cookie = adminCookie) => post(`/tokens/${token}/hide`, cookie);
const unhide = (token = SPAM, cookie = adminCookie) => post(`/tokens/${token}/unhide`, cookie);
const listed = async (q?: string) => ((await (await app.request(`/sepolia/tokens${q ? `?q=${q}` : ""}`)).json()) as { items: { address: string }[] }).items.map((t) => t.address);
const comment = (token: string, author: string, body: string) =>
  prisma.comment.create({ data: { chainId: CHAIN_ID, token, author, body } });
const asUser = async (address: string) => prisma.appUser.upsert({ where: { address }, create: { address }, update: {} });

describe("hiding a token", () => {
  // Review Focus 1: hiding must be complete, or a shared link defeats it.
  it("removes it from the list, from search AND from its own detail endpoint", async () => {
    expect(await listed()).toContain(SPAM);
    expect((await hide()).status).toBe(200);
    expect(await listed()).not.toContain(SPAM);
    expect(await listed("spam")).toEqual([]);
    expect((await app.request(`/sepolia/tokens/${SPAM}`)).status).toBe(404);
  });

  it("removes what hangs off it too: trades, holders, candles and comments answer 404, so a direct link shows nothing", async () => {
    await seedTrade({ token: SPAM, blockNumber: 1, logIndex: 0 });
    await seedBalance({ token: SPAM, holder: addr(0xa1), amount: 5n });
    await hide();
    for (const path of ["trades", "holders", "candles", "comments"]) {
      expect((await app.request(`/sepolia/tokens/${SPAM}/${path}`)).status, path).toBe(404);
    }
  });

  it("leaves every other token alone", async () => {
    await hide();
    expect(await listed()).toEqual([GOOD]);
    expect((await app.request(`/sepolia/tokens/${GOOD}`)).status).toBe(200);
  });

  // A token can be spam before its metadata ever resolves; hiding must not need an existing row.
  it("hides a token that has no metadata row yet, by creating one, and the resolver leaves it hidden", async () => {
    expect(await prisma.tokenMetadata.count()).toBe(0);
    expect((await hide()).status).toBe(200);
    const row = await prisma.tokenMetadata.findUniqueOrThrow({ where: { chainId_token: { chainId: CHAIN_ID, token: SPAM } } });
    expect(row).toMatchObject({ status: "hidden", uri: "ipfs://spam" });
    const { resolvePending } = await import("../../metadata/resolver.js");
    await resolvePending({ gateway: "http://127.0.0.1:1" });
    expect((await prisma.tokenMetadata.findUniqueOrThrow({ where: { chainId_token: { chainId: CHAIN_ID, token: SPAM } } })).status).toBe("hidden");
  });

  it("hides a token that never named a metadata URI", async () => {
    const bare = addr(0x53);
    await seedToken({ address: bare, name: "Bare", ticker: "BARE" });
    expect((await hide(bare)).status).toBe(200);
    expect(await listed()).not.toContain(bare);
  });

  it("records who hid it, and when", async () => {
    const before = Date.now();
    const res = await hide();
    const body = (await res.json()) as { hidden: boolean; hiddenBy: string; hiddenAt: string };
    expect(body).toMatchObject({ hidden: true, hiddenBy: admin.address.toLowerCase() });
    const row = await prisma.tokenMetadata.findFirstOrThrow({ where: { token: SPAM } });
    expect(row.hiddenBy).toBe(admin.address.toLowerCase());
    expect(row.hiddenAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("is idempotent: hiding twice is not an error, and the record keeps whoever hid it first", async () => {
    await hide(SPAM, adminCookie);
    const first = await prisma.tokenMetadata.findFirstOrThrow({ where: { token: SPAM } });
    const again = await hide(SPAM, otherAdminCookie);
    expect(again.status).toBe(200);
    const row = await prisma.tokenMetadata.findFirstOrThrow({ where: { token: SPAM } });
    expect(row.hiddenBy).toBe(admin.address.toLowerCase());
    expect(row.hiddenAt).toEqual(first.hiddenAt);
  });

  it("hides a token whose metadata had already resolved, and forgets nothing else about the row", async () => {
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: SPAM, uri: "ipfs://spam", status: "ok", name: "Spam Coin" } });
    await hide();
    expect(await prisma.tokenMetadata.findFirstOrThrow({ where: { token: SPAM } })).toMatchObject({ status: "hidden", name: "Spam Coin" });
  });

  it("answers 404 for a token the indexer has not seen, and 400 for something that is not an address", async () => {
    expect((await hide(addr(0x99))).status).toBe(404);
    expect((await post("/tokens/not-an-address/hide", adminCookie)).status).toBe(400);
    expect(await prisma.tokenMetadata.count()).toBe(0); // nothing was invented for it
  });
});

describe("unhiding a token", () => {
  it("restores it everywhere it was removed from", async () => {
    await hide();
    const res = await unhide();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hidden: false });
    expect(await listed()).toContain(SPAM);
    expect(await listed("spam")).toEqual([SPAM]);
    expect((await app.request(`/sepolia/tokens/${SPAM}`)).status).toBe(200);
    expect((await app.request(`/sepolia/tokens/${SPAM}/trades`)).status).toBe(200);
  });

  it("puts it back to be resolved again, with no hider on the record", async () => {
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: SPAM, uri: "ipfs://spam", status: "ok", attempts: 3 } });
    await hide();
    await unhide();
    expect(await prisma.tokenMetadata.findFirstOrThrow({ where: { token: SPAM } })).toMatchObject({ status: "pending", attempts: 0, nextAttempt: null, hiddenBy: null, hiddenAt: null });
  });

  it("brings back the comments the hidden token had, since none was deleted", async () => {
    const { address } = await session(randomAccount());
    await asUser(address);
    await comment(SPAM, address, "still here");
    await hide();
    await unhide();
    const list = (await (await app.request(`/sepolia/tokens/${SPAM}/comments`)).json()) as { items: { body: string }[] };
    expect(list.items.map((c) => c.body)).toEqual(["still here"]);
  });

  it("is not an error on a token that is not hidden, and never turns one into a hidden or pending one", async () => {
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: GOOD, uri: "ipfs://good", status: "ok", name: "Good Coin" } });
    const res = await unhide(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hidden: false });
    expect((await prisma.tokenMetadata.findFirstOrThrow({ where: { token: GOOD } })).status).toBe("ok");
  });

  it("answers 404 for a token the indexer has not seen", async () => {
    expect((await unhide(addr(0x99))).status).toBe(404);
  });
});

describe("hiding a comment", () => {
  it("stops serving it and keeps the row", async () => {
    await asUser(userAddress);
    const a = await comment(GOOD, userAddress, "keep");
    const b = await comment(GOOD, userAddress, "bad");
    const res = await post(`/comments/${b.id}/hide`, adminCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: String(b.id), hidden: true });
    const list = (await (await app.request(`/sepolia/tokens/${GOOD}/comments`)).json()) as { items: { id: string }[] };
    expect(list.items.map((c) => c.id)).toEqual([String(a.id)]);
    expect(await prisma.comment.count()).toBe(2);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: b.id } })).hidden).toBe(true);
  });

  it("is idempotent", async () => {
    await asUser(userAddress);
    const c = await comment(GOOD, userAddress, "bad");
    expect((await post(`/comments/${c.id}/hide`, adminCookie)).status).toBe(200);
    expect((await post(`/comments/${c.id}/hide`, adminCookie)).status).toBe(200);
  });

  it("answers 404 for a comment that does not exist, and for one on another chain, and 400 for an id that is not a number", async () => {
    await asUser(userAddress);
    const elsewhere = await prisma.comment.create({ data: { chainId: 1, token: GOOD, author: userAddress, body: "mainnet" } });
    expect((await post("/comments/999999/hide", adminCookie)).status).toBe(404);
    expect((await post(`/comments/${elsewhere.id}/hide`, adminCookie)).status).toBe(404);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: elsewhere.id } })).hidden).toBe(false);
    for (const bad of ["abc", "1e3", "-1", "99999999999999999999999"]) expect((await post(`/comments/${bad}/hide`, adminCookie)).status, bad).toBe(400);
  });
});

describe("banning a user", () => {
  it("hides every comment they wrote at once, on every token, and keeps the rows", async () => {
    await asUser(userAddress);
    await comment(GOOD, userAddress, "one");
    await comment(SPAM, userAddress, "two");
    const res = await post(`/users/${userAddress}/ban`, adminCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ address: userAddress });
    for (const t of [GOOD, SPAM]) {
      const list = (await (await app.request(`/sepolia/tokens/${t}/comments`)).json()) as { items: unknown[] };
      expect(list.items, t).toEqual([]);
    }
    expect(await prisma.comment.count()).toBe(2);
    expect((await prisma.comment.findFirstOrThrow()).hidden).toBe(false); // hidden by the ban, not by a flag: lifting the ban brings them back
  });

  it("leaves other people's comments alone", async () => {
    const other = (await session(randomAccount())).address;
    await asUser(userAddress);
    await asUser(other);
    await comment(GOOD, userAddress, "banned's");
    await comment(GOOD, other, "someone else's");
    await post(`/users/${userAddress}/ban`, adminCookie);
    const list = (await (await app.request(`/sepolia/tokens/${GOOD}/comments`)).json()) as { items: { body: string }[] };
    expect(list.items.map((c) => c.body)).toEqual(["someone else's"]);
  });

  it("keeps them from posting again", async () => {
    await post(`/users/${userAddress}/ban`, adminCookie);
    const res = await app.request(`/sepolia/tokens/${GOOD}/comments`, { method: "POST", headers: { "content-type": "application/json", cookie: userCookie }, body: JSON.stringify({ body: "let me in" }) });
    expect(res.status).toBe(403);
  });

  it("can ban someone who has never commented, so they are refused when they try", async () => {
    const stranger = addr(0x7777);
    expect((await post(`/users/${stranger}/ban`, adminCookie)).status).toBe(200);
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address: stranger } })).bannedAt).not.toBeNull();
  });

  it("is idempotent, and keeps the time of the first ban", async () => {
    await post(`/users/${userAddress}/ban`, adminCookie);
    const first = (await prisma.appUser.findUniqueOrThrow({ where: { address: userAddress } })).bannedAt;
    expect((await post(`/users/${userAddress}/ban`, otherAdminCookie)).status).toBe(200);
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address: userAddress } })).bannedAt).toEqual(first);
  });

  it("takes an address in any case, and refuses what is not one", async () => {
    expect((await post(`/users/${userAddress.toUpperCase().replace("0X", "0x")}/ban`, adminCookie)).status).toBe(200);
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address: userAddress } })).bannedAt).not.toBeNull();
    expect((await post("/users/nobody/ban", adminCookie)).status).toBe(400);
  });
});

describe("putting back a comment", () => {
  it("serves a hidden comment again, and keeps its place in the thread", async () => {
    await asUser(userAddress);
    const a = await comment(GOOD, userAddress, "first");
    const b = await comment(GOOD, userAddress, "second");
    await post(`/comments/${a.id}/hide`, adminCookie);
    const res = await post(`/comments/${a.id}/unhide`, adminCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: String(a.id), hidden: false });
    const list = (await (await app.request(`/sepolia/tokens/${GOOD}/comments`)).json()) as { items: { id: string }[] };
    expect(list.items.map((c) => c.id)).toEqual([String(b.id), String(a.id)]);
  });

  it("is idempotent, and is not an error on a comment that was never hidden", async () => {
    await asUser(userAddress);
    const c = await comment(GOOD, userAddress, "fine");
    expect((await post(`/comments/${c.id}/unhide`, adminCookie)).status).toBe(200);
    expect((await post(`/comments/${c.id}/unhide`, adminCookie)).status).toBe(200);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).hidden).toBe(false);
  });

  it("answers 404 for a comment that does not exist or is on another chain, and 400 for an id that is not a number", async () => {
    await asUser(userAddress);
    const elsewhere = await prisma.comment.create({ data: { chainId: 1, token: GOOD, author: userAddress, body: "mainnet", hidden: true } });
    expect((await post("/comments/999999/unhide", adminCookie)).status).toBe(404);
    expect((await post(`/comments/${elsewhere.id}/unhide`, adminCookie)).status).toBe(404);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: elsewhere.id } })).hidden).toBe(true);
    for (const bad of ["abc", "1e3", "-1"]) expect((await post(`/comments/${bad}/unhide`, adminCookie)).status, bad).toBe(400);
  });

  it("does not bring back a comment whose author is banned or whose token is hidden: those stay hidden by their own cause", async () => {
    await asUser(userAddress);
    const c = await comment(GOOD, userAddress, "bad");
    await post(`/comments/${c.id}/hide`, adminCookie);
    await post(`/users/${userAddress}/ban`, adminCookie);
    expect((await post(`/comments/${c.id}/unhide`, adminCookie)).status).toBe(200);
    const list = (await (await app.request(`/sepolia/tokens/${GOOD}/comments`)).json()) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });
});

describe("lifting a ban", () => {
  it("lets them post again and brings their comments back", async () => {
    await asUser(userAddress);
    await comment(GOOD, userAddress, "old");
    await post(`/users/${userAddress}/ban`, adminCookie);
    const res = await post(`/users/${userAddress}/unban`, adminCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: userAddress, banned: false });
    const list = (await (await app.request(`/sepolia/tokens/${GOOD}/comments`)).json()) as { items: { body: string }[] };
    expect(list.items.map((c) => c.body)).toEqual(["old"]);
    const posted = await app.request(`/sepolia/tokens/${GOOD}/comments`, { method: "POST", headers: { "content-type": "application/json", cookie: userCookie }, body: JSON.stringify({ body: "back" }) });
    expect(posted.status).toBe(201);
  });

  it("does not bring back what a moderator hid by hand", async () => {
    await asUser(userAddress);
    const c = await comment(GOOD, userAddress, "hidden by hand");
    await post(`/comments/${c.id}/hide`, adminCookie);
    await post(`/users/${userAddress}/ban`, adminCookie);
    await post(`/users/${userAddress}/unban`, adminCookie);
    const list = (await (await app.request(`/sepolia/tokens/${GOOD}/comments`)).json()) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  it("is not an error for someone who is not banned, and never creates a person who was never seen", async () => {
    const stranger = addr(0x7778);
    expect((await post(`/users/${userAddress}/unban`, adminCookie)).status).toBe(200);
    expect((await post(`/users/${stranger}/unban`, adminCookie)).status).toBe(200);
    expect(await prisma.appUser.findUnique({ where: { address: stranger } })).toBeNull();
  });

  it("takes an address in any case, and refuses what is not one", async () => {
    await post(`/users/${userAddress}/ban`, adminCookie);
    expect((await post(`/users/${userAddress.toUpperCase().replace("0X", "0x")}/unban`, adminCookie)).status).toBe(200);
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address: userAddress } })).bannedAt).toBeNull();
    expect((await post("/users/nobody/unban", adminCookie)).status).toBe(400);
  });
});

describe("the record of what moderators did", () => {
  const events = () => prisma.moderationEvent.findMany({ orderBy: { id: "asc" } });

  it("writes one row for each thing that changed, saying what, to whom, by whom, on which chain", async () => {
    await asUser(userAddress);
    const c = await comment(GOOD, userAddress, "bad");
    await hide();
    await unhide();
    await post(`/comments/${c.id}/hide`, adminCookie);
    await post(`/comments/${c.id}/unhide`, otherAdminCookie);
    await post(`/users/${userAddress}/ban`, adminCookie);
    await post(`/users/${userAddress}/unban`, adminCookie);
    const rows = await events();
    expect(rows.map((r) => [r.action, r.target, r.actor])).toEqual([
      ["token_hide", SPAM, admin.address.toLowerCase()],
      ["token_unhide", SPAM, admin.address.toLowerCase()],
      ["comment_hide", String(c.id), admin.address.toLowerCase()],
      ["comment_unhide", String(c.id), otherAdmin.address.toLowerCase()],
      ["user_ban", userAddress, admin.address.toLowerCase()],
      ["user_unban", userAddress, admin.address.toLowerCase()],
    ]);
    expect(rows.every((r) => r.chainId === CHAIN_ID && r.createdAt instanceof Date)).toBe(true);
  });

  it("keeps who hid a token after it is unhidden, since the token row forgets", async () => {
    await hide();
    await unhide(SPAM, otherAdminCookie);
    expect((await events()).map((r) => [r.action, r.actor])).toEqual([
      ["token_hide", admin.address.toLowerCase()],
      ["token_unhide", otherAdmin.address.toLowerCase()],
    ]);
  });

  it("writes nothing for a repeat that changed nothing", async () => {
    await asUser(userAddress);
    const c = await comment(GOOD, userAddress, "bad");
    for (const path of [`/tokens/${SPAM}/hide`, `/tokens/${SPAM}/hide`, `/comments/${c.id}/hide`, `/comments/${c.id}/hide`, `/users/${userAddress}/ban`, `/users/${userAddress}/ban`]) {
      await post(path, adminCookie);
    }
    expect((await events()).map((r) => r.action)).toEqual(["token_hide", "comment_hide", "user_ban"]);
    await post(`/tokens/${GOOD}/unhide`, adminCookie);
    await post(`/users/${addr(0x9999)}/unban`, adminCookie);
    expect(await prisma.moderationEvent.count()).toBe(3);
  });

  it("writes nothing when the request is refused or the target is not found", async () => {
    await post(`/tokens/${SPAM}/hide`, userCookie);
    await post(`/tokens/${addr(0x1)}/hide`, adminCookie);
    await post("/comments/999999/hide", adminCookie);
    await post("/users/nobody/ban", adminCookie);
    expect(await prisma.moderationEvent.count()).toBe(0);
  });
});

describe("telling people who have the page open", () => {
  it("says a token was hidden, once per change, and not when nothing changed", async () => {
    await hide();
    await hide();
    expect(told).toEqual([{ type: "token_hidden", chain: "sepolia", token: SPAM }]);
  });

  it("says which comments were hidden: the one comment, and every visible one by a banned author, token by token", async () => {
    await asUser(userAddress);
    const a = await comment(GOOD, userAddress, "one");
    const b = await comment(SPAM, userAddress, "two");
    const c = await comment(SPAM, userAddress, "three");
    await post(`/comments/${a.id}/hide`, adminCookie);
    expect(told).toEqual([{ type: "comments_hidden", chain: "sepolia", token: GOOD, ids: [String(a.id)] }]);
    told.length = 0;
    await post(`/users/${userAddress}/ban`, adminCookie);
    expect(told).toEqual([{ type: "comments_hidden", chain: "sepolia", token: SPAM, ids: [String(b.id), String(c.id)] }]);
  });

  it("says nothing when the request is refused", async () => {
    await post(`/tokens/${SPAM}/hide`, userCookie);
    expect(told).toEqual([]);
  });

  it("still answers when telling people fails: the change was made", async () => {
    const failing = createApp({
      auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN },
      adminAddresses: [admin.address],
      publishModeration: async () => {
        throw new Error("redis is down");
      },
    });
    const signed = await signIn(failing, admin);
    const res = await failing.request(`/sepolia/admin/tokens/${SPAM}/hide`, { method: "POST", headers: { "content-type": "application/json", cookie: signed.cookie }, body: "{}" });
    expect(res.status).toBe(200);
    expect(await listed()).not.toContain(SPAM);
  });
});

describe("who may do any of this", () => {
  const targets = (comment: string) => [
    `/tokens/${SPAM}/hide`,
    `/tokens/${SPAM}/unhide`,
    `/comments/${comment}/hide`,
    `/comments/${comment}/unhide`,
    `/users/${userAddress}/ban`,
    `/users/${userAddress}/unban`,
  ];

  it("refuses a signed-in non-admin and an anonymous caller alike, and changes nothing", async () => {
    await asUser(userAddress);
    const c = await comment(GOOD, userAddress, "mine");
    for (const path of targets(String(c.id))) {
      for (const cookie of [userCookie, undefined]) {
        const res = await post(path, cookie);
        expect(res.status, path).toBe(404);
      }
    }
    expect(await prisma.tokenMetadata.count()).toBe(0);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).hidden).toBe(false);
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address: userAddress } })).bannedAt).toBeNull();
  });

  // Review Focus 4: nothing about the refusal may say these routes exist.
  it("answers a non-admin exactly as it answers a path that does not exist, for every route", async () => {
    for (const path of targets("1")) {
      const nothing = await app.request(`/sepolia/nothing${path.slice(path.indexOf("/", 1))}`, { method: "POST", headers: { "content-type": "application/json", cookie: userCookie }, body: "{}" });
      const refused = await post(path, userCookie);
      const anon = await post(path);
      expect(refused.status, path).toBe(nothing.status);
      expect(await refused.json(), path).toEqual(await nothing.json());
      expect(await anon.json(), path).toEqual(await (await app.request(`/sepolia/nothing/x`, { method: "POST" })).json());
    }
  });

  it("does not answer for an unknown chain differently because the path says admin", async () => {
    const admin404 = await app.request("/nochain/admin/tokens/x/hide", { method: "POST", headers: { cookie: userCookie } });
    const plain404 = await app.request("/nochain/whatever/tokens/x/hide", { method: "POST", headers: { cookie: userCookie } });
    expect(admin404.status).toBe(plain404.status);
    expect(await admin404.json()).toEqual(await plain404.json());
  });

  it("wants the request sent as JSON: a plain form post from another page is refused, and nothing changes", async () => {
    for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data"]) {
      expect((await post(`/tokens/${SPAM}/hide`, adminCookie, "x=1", type)).status, type).toBe(400);
    }
    expect((await app.request(`/sepolia/admin/tokens/${SPAM}/hide`, { method: "POST", headers: { cookie: adminCookie } })).status).toBe(400);
    expect(await listed()).toContain(SPAM);
  });

  it("does not let a page hide a token with a simple GET", async () => {
    const res = await app.request(`/sepolia/admin/tokens/${SPAM}/hide`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(404);
    expect(await listed()).toContain(SPAM);
  });
});
