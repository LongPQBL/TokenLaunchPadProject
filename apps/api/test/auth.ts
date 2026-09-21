import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hono } from "hono";
import type { AppEnv } from "../src/app.js";

export const TEST_DOMAIN = "launchpad.test";
export const TEST_URI = "https://launchpad.test";
export const TEST_CHAIN = 11155111;

/** A wallet nobody has ever used: a random key, never a well-known one. */
export const randomAccount = () => privateKeyToAccount(generatePrivateKey());

export type TestAccount = ReturnType<typeof randomAccount>;

/** Runs the whole sign-in: asks for a challenge, signs it, and returns the session cookie, ready to send back. */
export async function signIn(app: Hono<AppEnv>, account: TestAccount = randomAccount()) {
  const challenge = await app.request(`/auth/nonce?address=${account.address}`);
  const { message } = (await challenge.json()) as { message: string };
  const signature = await account.signMessage({ message });
  const res = await app.request("/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { res, cookie, address: account.address.toLowerCase(), account, message, signature };
}
