import { sepolia } from "viem/chains";

export interface CspInput {
  /** Fresh per request: base64, unguessable. Refused if it is anything else, since it goes into a header. */
  nonce: string;
  isDev: boolean;
  apiUrl: string;
  /** The RPC the browser reads the chain through. Absent means the client's built-in default for the chain. */
  rpcUrl: string | undefined;
  /** Hosts token images may load from: the configured IPFS gateway, never "any https host". */
  imageOrigins: string[];
  walletConnect: boolean;
  /** Privy is part of this build: its login frames and API connections are let through, and nothing else about the policy changes. */
  privy?: boolean;
}

/** What Privy's own documentation lists as required, and no more. Scripts are NOT here: the nonce and strict-dynamic already cover what Privy loads. */
const PRIVY_FRAMES = ["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org", "https://challenges.cloudflare.com"];
const PRIVY_CONNECT = [
  "https://auth.privy.io",
  "https://*.rpc.privy.systems",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "wss://www.walletlink.org",
  "https://explorer-api.walletconnect.com",
];

/** An origin (scheme, host, port) from a URL, or undefined: only http(s) and only what parses. A path or a key is dropped. */
function origin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The page's Content Security Policy. From the moment a browser holds a key with funds in it, an injected script is not a
 * nuisance but a theft, so this is strict: scripts run only if they carry this request's nonce (or were loaded by one that
 * did), nothing may be framed or posted elsewhere, and the page may talk only to itself, the API and the RPC. It is the
 * second line of defence: the first is that no hostile string is ever rendered as markup (spec §11).
 */
export function buildCsp({ nonce, isDev, apiUrl, rpcUrl, imageOrigins, walletConnect, privy = false }: CspInput): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) throw new Error("the CSP nonce must be base64");

  // A websocket is a different scheme from the page that opens it, and not every browser counts wss: as a match for https:, so
  // the API's own socket address is named as well as its https one.
  const socketOf = (o: string | undefined) => (o ? o.replace(/^http/, "ws") : undefined);
  const connect = [
    "'self'",
    origin(apiUrl),
    socketOf(origin(apiUrl)),
    origin(rpcUrl ?? sepolia.rpcUrls.default.http[0]),
    ...(walletConnect ? ["wss://relay.walletconnect.org", "https://rpc.walletconnect.org"] : []),
    ...(privy ? PRIVY_CONNECT : []),
  ].filter((x): x is string => !!x);
  const images = ["'self'", "data:", "blob:", ...imageOrigins.map(origin).filter((x): x is string => !!x)];

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Styles are the ONE place this is not strict: Radix (dialogs, popovers) and Next's own error pages create <style>
    // elements at run time with no way to give them a nonce, so a nonce'd style-src would break every dialog. A stylesheet
    // cannot run script, and this page keeps nothing secret in its markup for CSS tricks to read (the session key never
    // touches the DOM). Scripts, the thing that matters, stay strict.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(" ")}`,
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    ...(privy ? [`frame-src ${PRIVY_FRAMES.join(" ")}`, `child-src ${PRIVY_FRAMES.slice(0, 3).join(" ")}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(origin(apiUrl)?.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** What the policy needs to know, from the build's environment. Read at use: Next inlines each NEXT_PUBLIC_ name in full. */
export function cspSources(env: Record<string, string | undefined>) {
  return {
    apiUrl: env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
    rpcUrl: origin(env.NEXT_PUBLIC_RPC_URL) ? env.NEXT_PUBLIC_RPC_URL : undefined,
    imageOrigins: (env.NEXT_PUBLIC_IMAGE_ORIGINS ?? "")
      .split(",")
      .map(origin)
      .filter((x): x is string => !!x),
    walletConnect: !!env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    privy: !!env.NEXT_PUBLIC_PRIVY_APP_ID?.trim(),
  };
}
