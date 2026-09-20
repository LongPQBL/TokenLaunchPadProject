import { Hono, type Context } from "hono";
import { z } from "zod";
import { isAddress } from "viem";
import type { AppEnv, AuthDeps } from "../app.js";
import { createChallenge, readMessage } from "../auth/challenge.js";
import { consumeNonce, endSession, requireSession, startSession, storeNonce } from "../auth/session.js";
import { verifyEoaSignature } from "../auth/signature.js";
import { apiError } from "../errors.js";
import { rateLimit } from "../middleware/rate-limit.js";

const body = z.object({ message: z.string().min(1).max(2_000), signature: z.string().regex(/^0x[0-9a-fA-F]{2,1000}$/) });

/** Behind a proxy every request arrives from the proxy, so the real client is the first entry it reports. */
function clientKey(c: Context, trustProxy: boolean): string {
  if (trustProxy) return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket;
  return socket?.remoteAddress ?? "unknown";
}

const SIGN_IN_FAILED = { error: "invalid_signin", message: "That sign-in could not be verified." } as const;

/**
 * Sign-in with Ethereum. Every way a sign-in can fail answers identically, so the response never says which check
 * tripped. The signature is checked BEFORE the nonce is spent: otherwise anyone could burn a stranger's challenge by
 * presenting a forgery against it.
 */
export function authRoutes(auth: AuthDeps | undefined): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const verify = auth?.verify ?? verifyEoaSignature;

  routes.get(
    "/auth/nonce",
    rateLimit({ bucket: "nonce", limit: 20, windowSeconds: 60, key: (c) => clientKey(c, auth?.trustProxy ?? false) }),
    async (c) => {
      if (!auth) return apiError(c, 503, "auth_unavailable", "Sign-in is not available.");
      const address = c.req.query("address") ?? "";
      if (!isAddress(address, { strict: false })) return apiError(c, 400, "bad_address", "Not a valid address.");
      const challenge = createChallenge({ address, chainId: auth.chainId, domain: auth.domain, uri: auth.uri });
      await storeNonce(challenge.nonce, address.toLowerCase());
      return c.json(challenge);
    },
  );

  routes.post("/auth/verify", async (c) => {
    if (!auth) return apiError(c, 503, "auth_unavailable", "Sign-in is not available.");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return apiError(c, 400, "bad_request", "Send a JSON body with a message and a signature.");
    }
    const parsed = body.safeParse(raw);
    if (!parsed.success) return apiError(c, 400, "bad_request", "Send a JSON body with a message and a signature.");
    const { message, signature } = parsed.data;

    const fields = readMessage(message, { domain: auth.domain, chainId: auth.chainId });
    if (!fields) return c.json(SIGN_IN_FAILED, 401);
    if (!(await verify({ address: fields.address, message, signature: signature as `0x${string}` }))) return c.json(SIGN_IN_FAILED, 401);

    const address = fields.address.toLowerCase();
    if (!(await consumeNonce(fields.nonce, address))) return c.json(SIGN_IN_FAILED, 401);

    await startSession(c, address);
    return c.json({ address });
  });

  routes.post("/auth/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  });

  routes.get("/me", requireSession, (c) => c.json({ address: c.get("address") }));

  return routes;
}
