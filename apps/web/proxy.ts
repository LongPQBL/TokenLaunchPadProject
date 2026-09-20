import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspSources } from "./lib/csp";

/**
 * Every page gets a strict Content Security Policy with a fresh nonce (spec §11). The nonce is also handed to the render
 * (as a request header), which is how Next stamps it on the scripts it writes: without it none of the app's own scripts
 * would run. Because a nonce must be new for every request, every page is rendered per request (see the root layout).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({ nonce, isDev: process.env.NODE_ENV === "development", ...cspSources(publicEnv()) });

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

/** Next only inlines a NEXT_PUBLIC_ variable written out in full, so they are named one by one here. */
const publicEnv = () => ({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_IMAGE_ORIGINS: process.env.NEXT_PUBLIC_IMAGE_ORIGINS,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});

export const config = {
  // Not for build output or images, and not for link prefetches (they carry no page of their own).
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
