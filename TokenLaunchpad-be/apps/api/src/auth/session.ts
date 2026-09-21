import { createHash, randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../app.js";
import { getSql } from "../db.js";
import { apiError } from "../errors.js";
import { NONCE_TTL_SECONDS } from "./challenge.js";

export const SESSION_COOKIE = "vezta_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The database keeps only a hash of the cookie's value: a leaked table is not a set of working sessions. */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Not readable by scripts (HttpOnly), never sent over plain HTTP (Secure; browsers treat localhost as secure), and
 * never sent on a cross-site request (SameSite=Lax), which is what keeps another site from acting as the person.
 */
const COOKIE = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

/** Hands out a challenge: remembers the nonce for the address it was issued to, and sweeps what has expired. */
export async function storeNonce(nonce: string, address: string): Promise<void> {
  const sql = getSql();
  await sql`delete from app.siwe_nonce where expires_at < now()`;
  await sql`delete from app.session where expires_at < now()`;
  await sql`insert into app.siwe_nonce (nonce, address, expires_at) values (${nonce}, ${address}, now() + make_interval(secs => ${NONCE_TTL_SECONDS}))`;
}

/** One atomic step: a nonce is used up by the same statement that checks it, so two requests cannot both spend it. */
export async function consumeNonce(nonce: string, address: string): Promise<boolean> {
  const rows = await getSql()`delete from app.siwe_nonce where nonce = ${nonce} and address = ${address} and expires_at > now() returning nonce`;
  return rows.length === 1;
}

export async function startSession(c: Context, address: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await getSql()`insert into app.session (id, address, expires_at) values (${hash(token)}, ${address}, now() + make_interval(secs => ${SESSION_TTL_SECONDS}))`;
  setCookie(c, SESSION_COOKIE, token, { ...COOKIE, maxAge: SESSION_TTL_SECONDS });
}

export async function endSession(c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await getSql()`delete from app.session where id = ${hash(token)}`;
  deleteCookie(c, SESSION_COOKIE, COOKIE);
}

/** The signed-in address, lower-case, or undefined. Expiry and revocation are checked on every request. */
export async function sessionAddress(c: Context): Promise<string | undefined> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return undefined;
  const [row] = await getSql()`select address from app.session where id = ${hash(token)} and expires_at > now()`;
  return row?.address;
}

/** In front of every route that needs a person: 401 without a live session, otherwise `address` is on the context. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const address = await sessionAddress(c);
  if (!address) return apiError(c, 401, "unauthenticated", "Sign in first.");
  c.set("address", address);
  await next();
};
