import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../test/auth.js";
import { resetAppData } from "../../test/app-data.js";
import { addr, seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";
import { getSql } from "../db.js";

const app = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN } });
const CHAIN_ID = 11155111;
const T1 = addr(0x61);
const T2 = addr(0x62);
const T3 = addr(0x63);

let cookie = "";
let me = "";

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
  await resetAppData();
  await seedToken.reset();
  for (const [i, t] of [T1, T2, T3].entries()) await seedToken({ address: t, name: `Token ${i}`, ticker: `T${i}` });
  const signed = await signIn(app);
  expect(signed.cookie, "sign-in must give a session cookie").toMatch(/^vezta_session=/);
  cookie = signed.cookie;
  me = signed.address;
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

const url = (token = "") => `/sepolia/me/favorites${token ? `/${token}` : ""}`;
// `null` is "no session"; leaving it out is "me".
const call = (method: string, path: string, withCookie: string | null = cookie) => app.request(path, { method, headers: withCookie ? { cookie: withCookie } : {} });
const star = (token: string, c?: string | null) => call("PUT", url(token), c);
const unstar = (token: string, c?: string | null) => call("DELETE", url(token), c);
const starred = async (c: string | null = cookie) => ((await (await call("GET", url(), c)).json()) as { tokens: string[] }).tokens;

describe("who may use it", () => {
  it("wants a session for all three: no cookie, no answer", async () => {
    for (const [method, path] of [["GET", url()], ["PUT", url(T1)], ["DELETE", url(T1)]] as const) {
      const res = await call(method, path, null);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(await prisma.favorite.count()).toBe(0);
  });

  it("never shows one person another's stars, and one's change does not touch the other", async () => {
    const other = await signIn(app);
    await star(T1);
    expect(await starred(other.cookie)).toEqual([]);
    await star(T2, other.cookie);
    await unstar(T2, other.cookie);
    expect(await starred()).toEqual([T1]);
  });

  it("answers an unknown chain like every other route", async () => {
    expect((await call("GET", "/nochain/me/favorites")).status).toBe(404);
  });
});

describe("starring", () => {
  it("saves a star, and lists it", async () => {
    const res = await star(T1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: T1, starred: true });
    expect(await starred()).toEqual([T1]);
    expect((await prisma.favorite.findFirstOrThrow()).address).toBe(me);
  });

  it("lists the newest star first", async () => {
    await star(T1);
    await star(T3);
    await star(T2);
    expect(await starred()).toEqual([T2, T3, T1]);
  });

  it("is idempotent: starring twice is one star, and the first time is kept", async () => {
    await star(T1);
    const first = (await prisma.favorite.findFirstOrThrow()).createdAt;
    expect((await star(T1)).status).toBe(200);
    expect(await prisma.favorite.count()).toBe(1);
    expect((await prisma.favorite.findFirstOrThrow()).createdAt).toEqual(first);
  });

  it("takes an address in any case and keeps it in lower case", async () => {
    expect((await star(T1.toUpperCase().replace("0X", "0x"))).status).toBe(200);
    expect(await starred()).toEqual([T1]);
  });

  it("answers 404 for a token the indexer has not seen, and 400 for something that is not an address, and stores nothing for either", async () => {
    expect((await star(addr(0x99))).status).toBe(404);
    expect((await star("nope")).status).toBe(400);
    expect(await prisma.favorite.count()).toBe(0);
  });

  it("answers 404 for a hidden token, as everywhere else, and lists no star on a token that was hidden after", async () => {
    await star(T1);
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: T1, uri: "ipfs://x", status: "hidden" } });
    expect(await starred()).toEqual([]);
    expect((await star(T1)).status).toBe(404);
    await prisma.tokenMetadata.update({ where: { chainId_token: { chainId: CHAIN_ID, token: T1 } }, data: { status: "ok" } });
    expect(await starred()).toEqual([T1]); // hiding took nothing from the person: unhiding gives it back
  });

  it("keeps a chain's stars to that chain", async () => {
    await prisma.appUser.upsert({ where: { address: me }, create: { address: me }, update: {} });
    await seedToken({ address: T2, chainId: 1, name: "Mainnet twin", ticker: "MT" }); // the same address is a token there too
    await prisma.favorite.create({ data: { chainId: 1, address: me, token: T2 } });
    await star(T1);
    expect(await starred()).toEqual([T1]);
  });

  it("stops at 500 stars a person and says so, yet lets a token that is already starred be starred again", async () => {
    await prisma.appUser.upsert({ where: { address: me }, create: { address: me }, update: {} });
    const others = Array.from({ length: 499 }, (_, i) => ({ chainId: CHAIN_ID, address: me, token: addr(0x1000 + i) }));
    await prisma.favorite.createMany({ data: [...others, { chainId: CHAIN_ID, address: me, token: T1 }] });
    const refused = await star(T2);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("too_many");
    expect(await prisma.favorite.count({ where: { address: me } })).toBe(500);
    expect((await star(T1)).status).toBe(200);
  });

  it("limits how fast one person may change their stars", async () => {
    let refused: Response | undefined;
    for (let i = 0; i < 70 && !refused; i++) {
      const res = await (i % 2 === 0 ? star(T1) : unstar(T1));
      if (res.status === 429) refused = res;
    }
    expect(refused, "a burst of changes must be refused at some point").toBeDefined();
    expect(refused!.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("unstarring", () => {
  it("removes the star, and only that one", async () => {
    await star(T1);
    await star(T2);
    const res = await unstar(T1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: T1, starred: false });
    expect(await starred()).toEqual([T2]);
  });

  it("is not an error to unstar what was never starred, or a token that does not exist", async () => {
    expect((await unstar(T3)).status).toBe(200);
    expect((await unstar(addr(0x99))).status).toBe(200);
  });

  it("refuses something that is not an address", async () => {
    expect((await unstar("nope")).status).toBe(400);
  });
});
