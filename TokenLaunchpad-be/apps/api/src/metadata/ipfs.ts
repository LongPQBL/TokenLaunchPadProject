// Content ids are base32/base58 text: letters and digits, nothing else. Real ones are 46+ characters; the lower
// bound only rejects the obviously empty, and the upper bound stops a stranger sending an enormous "id".
const CID = /^[A-Za-z0-9]{5,100}$/;
// A path segment. No "%" so there is no encoded traversal, no "\" or ":" or "@" so nothing can change the host.
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

// ipfs.io (and its sibling dweb.link) stopped serving path-gateway requests server-side some time before
// 2026-09-22 — every fetch through it now returns 429 "This IPFS gateway is switching to a service worker
// gateway only", which only works from a browser. Confirmed live by fetching the same CID through both:
// ipfs.io/dweb.link 429, gateway.pinata.cloud 200 — and this project already holds a Pinata account for pinning,
// so its own gateway is the natural replacement.
/** The public gateway used when IPFS_GATEWAY_URL is not set. The one place it is written; everything else says DEFAULT_IPFS_GATEWAY. */
export const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud";

/**
 * Maps an ipfs:// URI onto OUR configured gateway, or returns undefined.
 *
 * The URI is written on-chain by anyone, and the server fetches whatever this returns. So it is the SSRF
 * boundary: the only host ever contacted is the gateway we configured. An http(s) URI would let a stranger aim
 * the server at cloud metadata endpoints (169.254.169.254) or at a database on localhost, so every scheme but
 * ipfs is refused, and the content id and path are checked so nothing can climb out of /ipfs/ or change the host.
 */
export function ipfsToHttp(uri: string, gateway: string): string | undefined {
  const match = /^ipfs:\/\/(.*)$/i.exec(uri);
  if (!match) return undefined;
  const [cid, ...path] = match[1]!.split("/");
  if (!cid || !CID.test(cid)) return undefined;
  for (const segment of path) {
    if (!SEGMENT.test(segment) || segment === "." || segment === "..") return undefined;
  }
  return `${gateway.replace(/\/+$/, "")}/ipfs/${[cid, ...path].join("/")}`;
}
