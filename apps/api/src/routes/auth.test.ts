import { createSiweMessage } from "viem/siwe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../test/auth.js";
import { createApp } from "../app.js";
import { getSql } from "../db.js";

const app = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN } });

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
});
afterAll(() => getSql().end());

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

async function challengeFor(address: string) {
  const res = await app.request(`/auth/nonce?address=${address}`);
  return (await res.json()) as { message: string; nonce: string };
}

describe("sign in: the accepted path", () => {
  it("accepts a valid signature and sets a session cookie that JavaScript cannot read, that only travels over HTTPS and never cross-site", async () => {
    const { res, cookie } = await signIn(app);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^vezta_session=.{30,}/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=\d+/i);
  });

  it("says who is signed in, lower-cased", async () => {
    const { cookie, address } = await signIn(app);
    const me = await app.request("/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ address });
  });

  it("stores the session under a hash, so a leaked table is not a set of working cookies", async () => {
    const { cookie } = await signIn(app);
    const token = cookie.split("=")[1]!;
    const rows = await getSql()`select id from app.session`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(token);
  });
});

describe("sign in: everything that must be refused", () => {
  it("refuses a signature from a different key than the address in the message", async () => {
    const victim = randomAccount();
    const attacker = randomAccount();
    const { message } = await challengeFor(victim.address);
    const res = await post("/auth/verify", { message, signature: await attacker.signMessage({ message }) });
    expect(res.status).toBe(401);
  });

  it("refuses a nonce this server never issued", async () => {
    const account = randomAccount();
    const message = createSiweMessage({ address: account.address, chainId: TEST_CHAIN, domain: TEST_DOMAIN, uri: TEST_URI, nonce: "madeupnonce123", version: "1" });
    const res = await post("/auth/verify", { message, signature: await account.signMessage({ message }) });
    expect(res.status).toBe(401);
  });

  it("refuses a message written for another site: the domain is what defeats phishing", async () => {
    const account = randomAccount();
    const { nonce } = await challengeFor(account.address);
    const message = createSiweMessage({ address: account.address, chainId: TEST_CHAIN, domain: "evil.example.com", uri: "https://evil.example.com", nonce, version: "1" });
    const res = await post("/auth/verify", { message, signature: await account.signMessage({ message }) });
    expect(res.status).toBe(401);
  });

  it("refuses a message for another chain", async () => {
    const account = randomAccount();
    const { nonce } = await challengeFor(account.address);
    const message = createSiweMessage({ address: account.address, chainId: 1, domain: TEST_DOMAIN, uri: TEST_URI, nonce, version: "1" });
    const res = await post("/auth/verify", { message, signature: await account.signMessage({ message }) });
    expect(res.status).toBe(401);
  });

  it("lets a nonce be used once: replaying the very same signature fails", async () => {
    const first = await signIn(app);
    expect(first.res.status).toBe(200);
    const replay = await post("/auth/verify", { message: first.message, signature: first.signature });
    expect(replay.status).toBe(401);
  });

  it("refuses a nonce that has expired", async () => {
    const account = randomAccount();
    const { message } = await challengeFor(account.address);
    await getSql()`update app.siwe_nonce set expires_at = now() - interval '1 second'`;
    const res = await post("/auth/verify", { message, signature: await account.signMessage({ message }) });
    expect(res.status).toBe(401);
  });

  it("refuses a nonce issued to one address and used by another who signed it themselves", async () => {
    const asker = randomAccount();
    const thief = randomAccount();
    const { nonce } = await challengeFor(asker.address);
    const message = createSiweMessage({ address: thief.address, chainId: TEST_CHAIN, domain: TEST_DOMAIN, uri: TEST_URI, nonce, version: "1" });
    const res = await post("/auth/verify", { message, signature: await thief.signMessage({ message }) });
    expect(res.status).toBe(401);
  });

  it("does not burn someone's nonce when a forged signature is tried against it", async () => {
    const victim = randomAccount();
    const attacker = randomAccount();
    const { message } = await challengeFor(victim.address);
    await post("/auth/verify", { message, signature: await attacker.signMessage({ message }) });
    // The real owner can still finish signing in.
    const ok = await post("/auth/verify", { message, signature: await victim.signMessage({ message }) });
    expect(ok.status).toBe(200);
  });

  it("answers every refusal the same way, so nothing says which check failed", async () => {
    const account = randomAccount();
    const message = createSiweMessage({ address: account.address, chainId: TEST_CHAIN, domain: "evil.example.com", uri: TEST_URI, nonce: "n0nc3n0nc3", version: "1" });
    const wrongDomain = await post("/auth/verify", { message, signature: await account.signMessage({ message }) });
    const forged = await post("/auth/verify", { message, signature: `0x${"11".repeat(65)}` });
    expect(await wrongDomain.json()).toEqual(await forged.json());
  });

  it("is a 400, not a crash, for a body that is not a message and a signature", async () => {
    for (const body of [{}, { message: 1, signature: "0x" }, { message: "x".repeat(5000), signature: "0x12" }, { message: "hello", signature: "not hex" }]) {
      const res = await post("/auth/verify", body);
      expect([400, 401]).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
    const raw = await app.request("/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(raw.status).toBe(400);
  });

  it("asks for a real address before it issues a challenge", async () => {
    for (const address of ["", "0x123", "javascript:alert(1)", "0x" + "z".repeat(40)]) {
      expect((await app.request(`/auth/nonce?address=${encodeURIComponent(address)}`)).status).toBe(400);
    }
  });

  it("limits how fast one client can ask for challenges", async () => {
    const account = randomAccount();
    const ask = () => app.request(`/auth/nonce?address=${account.address}`);
    let last = 200;
    for (let i = 0; i < 40; i++) last = (await ask()).status;
    expect(last).toBe(429);
  });
});

describe("the session", () => {
  it("is refused without a cookie, with a made-up one, and once expired", async () => {
    expect((await app.request("/me")).status).toBe(401);
    expect((await app.request("/me", { headers: { cookie: "vezta_session=notarealsession" } })).status).toBe(401);

    const { cookie } = await signIn(app);
    await getSql()`update app.session set expires_at = now() - interval '1 second'`;
    expect((await app.request("/me", { headers: { cookie } })).status).toBe(401);
  });

  it("ends on logout, on the server, so the cookie is dead even if it is kept", async () => {
    const { cookie } = await signIn(app);
    const out = await post("/auth/logout", {}, cookie);
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await app.request("/me", { headers: { cookie } })).status).toBe(401);
  });

  it("can be revoked by deleting its row: a ban takes effect on the next request", async () => {
    const { cookie } = await signIn(app);
    await getSql()`delete from app.session`;
    expect((await app.request("/me", { headers: { cookie } })).status).toBe(401);
  });

  it("clears expired challenges and sessions as it goes, so the tables do not grow forever", async () => {
    await signIn(app);
    await getSql()`update app.siwe_nonce set expires_at = now() - interval '1 hour'`;
    await getSql()`insert into app.siwe_nonce (nonce, address, expires_at) values ('stale', '0xa', now() - interval '2 hours')`;
    await challengeFor(randomAccount().address);
    const stale = await getSql()`select nonce from app.siwe_nonce where expires_at < now()`;
    expect(stale).toHaveLength(0);
  });
});

describe("when sign-in is not configured", () => {
  it("says so plainly instead of pretending", async () => {
    const bare = createApp({});
    expect((await bare.request(`/auth/nonce?address=${randomAccount().address}`)).status).toBe(503);
    expect((await bare.request("/me")).status).toBe(401);
  });
});
