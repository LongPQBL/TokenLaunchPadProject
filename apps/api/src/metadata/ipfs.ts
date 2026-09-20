// Content ids are base32/base58 text: letters and digits, nothing else. Real ones are 46+ characters; the lower
// bound only rejects the obviously empty, and the upper bound stops a stranger sending an enormous "id".
const CID = /^[A-Za-z0-9]{5,100}$/;
// A path segment. No "%" so there is no encoded traversal, no "\" or ":" or "@" so nothing can change the host.
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

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
