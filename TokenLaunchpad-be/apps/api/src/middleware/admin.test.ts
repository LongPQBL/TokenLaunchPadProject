import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../test/auth.js";
import { createApp, type AppEnv } from "../app.js";
import { getSql } from "../db.js";
import { createRequireAdmin } from "./admin.js";

const signInApp = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN } });

/** The middleware on its own, in front of one route, next to an app that has no such route. */
function appFor(admins: string[]) {
  const app = new Hono<AppEnv>();
  app.notFound((c) => c.json({ error: "not_found", message: "Not found." }, 404));
  app.use("/admin/*", createRequireAdmin(admins));
  app.get("/admin/reports", (c) => c.json({ ok: true, admin: c.get("address") }));
  return app;
}

const admin = randomAccount();
const someone = randomAccount();
/** A real session, or the test stops: a refusal proves nothing if the person never had a session to be refused for. */
async function session(account: typeof admin) {
  const signed = await signIn(signInApp, account);
  expect(signed.cookie, "sign-in must give a session cookie").toMatch(/^vezta_session=/);
  return signed;
}
const get = (app: Hono<AppEnv>, cookie?: string, path = "/admin/reports") => app.request(path, { headers: cookie ? { cookie } : {} });

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
});
afterAll(async () => {
  await getSql().end();
});

describe("requireAdmin", () => {
  it("lets an address on the list through, and hands the route who they are", async () => {
    const { cookie, address } = await session(admin);
    const res = await get(appFor([admin.address]), cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, admin: address });
  });

  // Review Focus 4: an attacker must not learn that /admin exists by the shape of the refusal.
  it("refuses a non-admin session and an anonymous request identically, and the same as a path that does not exist", async () => {
    const app = appFor([admin.address]);
    const { cookie } = await session(someone);
    const anon = await get(app);
    const user = await get(app, cookie);
    const nothing = await get(app, undefined, "/no/such/path");
    expect(anon.status).toBe(404);
    expect(user.status).toBe(anon.status);
    expect(await user.json()).toEqual(await anon.json());
    expect(nothing.status).toBe(anon.status);
    expect(await nothing.json()).toEqual(await (await get(app)).json());
    expect([...user.headers.keys()].sort()).toEqual([...anon.headers.keys()].sort());
  });

  it("refuses a cookie that is not a session, as it would a missing one", async () => {
    const res = await get(appFor([admin.address]), "vezta_session=not-a-real-session");
    expect(res.status).toBe(404);
  });

  it("refuses an admin whose session has ended", async () => {
    const { cookie } = await session(admin);
    await getSql()`truncate app.session`;
    expect((await get(appFor([admin.address]), cookie)).status).toBe(404);
  });

  it("matches addresses case-insensitively: a checksummed value in the list still works", async () => {
    const { cookie } = await session(admin);
    expect(getAddress(admin.address)).not.toBe(admin.address.toLowerCase()); // it does have upper-case letters
    expect((await get(appFor([getAddress(admin.address)]), cookie)).status).toBe(200);
    expect((await get(appFor([admin.address.toUpperCase().replace("0X", "0x")]), cookie)).status).toBe(200);
  });

  it("refuses everyone when the list is empty, rather than allowing everyone", async () => {
    const { cookie } = await session(admin);
    expect((await get(appFor([]), cookie)).status).toBe(404);
    expect((await get(appFor([]))).status).toBe(404);
  });

  it("does not treat an empty entry as a wildcard", async () => {
    const { cookie } = await session(someone);
    expect((await get(appFor([""]), cookie)).status).toBe(404);
  });

  it("checks the whole address, not a prefix of it", async () => {
    const { cookie } = await session(someone);
    expect((await get(appFor([someone.address.slice(0, 20)]), cookie)).status).toBe(404);
  });
});
