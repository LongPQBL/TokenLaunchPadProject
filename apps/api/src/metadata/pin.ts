import { createHash } from "node:crypto";

/** Pinning failed. `message` is fixed and safe to log or show; `status` is what the pinning service answered, for the log. */
export class PinError extends Error {
  constructor(readonly status?: number) {
    super("Could not pin to IPFS.");
    this.name = "PinError";
  }
}

export interface Pinner {
  pinFile(bytes: Buffer, name: string, contentType: string): Promise<string>;
  pinJson(value: unknown, name: string): Promise<string>;
}

// A CID becomes part of an ipfs:// URI written on chain, so what a service answers with is checked, not trusted.
const CID = /^[A-Za-z0-9]{5,100}$/;
const PINATA = "https://api.pinata.cloud";

/**
 * Pins through Pinata. The key lives only here, in the API's environment. Whatever goes wrong is reported as a PinError
 * with a fixed message: the service's own error text and the underlying network error can carry the key or account
 * details, and none of it belongs in a response or a log line.
 */
export function pinataPinner(jwt: string, fetchImpl: typeof fetch = fetch, timeoutMs = 30_000): Pinner {
  async function call(path: string, init: RequestInit): Promise<string> {
    let res: Response;
    try {
      res = await fetchImpl(`${PINATA}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${jwt}`, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PinError();
    }
    if (!res.ok) throw new PinError(res.status);
    let hash: unknown;
    try {
      hash = ((await res.json()) as { IpfsHash?: unknown }).IpfsHash;
    } catch {
      throw new PinError(res.status);
    }
    if (typeof hash !== "string" || !CID.test(hash)) throw new PinError(res.status);
    return hash;
  }

  return {
    pinFile(bytes, name, contentType) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), name);
      form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
      form.append("pinataMetadata", JSON.stringify({ name }));
      return call("/pinning/pinFileToIPFS", { method: "POST", body: form });
    },
    pinJson(value, name) {
      return call("/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinataContent: value, pinataMetadata: { name }, pinataOptions: { cidVersion: 1 } }),
      });
    },
  };
}

/**
 * For local development and tests: pins nothing, and answers with a CID derived from the content. It also keeps what it
 * was given so a test can look at exactly what would have been pinned. Never used in production (see config).
 */
export function fakePinner() {
  const files: { bytes: Buffer; name: string; contentType: string }[] = [];
  const jsons: { value: unknown; name: string }[] = [];
  const cid = (data: string | Buffer) => `bafyfake${createHash("sha256").update(data).digest("hex").slice(0, 44)}`;
  return {
    files,
    jsons,
    async pinFile(bytes: Buffer, name: string, contentType: string) {
      files.push({ bytes, name, contentType });
      return cid(bytes);
    },
    async pinJson(value: unknown, name: string) {
      jsons.push({ value, name });
      return cid(JSON.stringify(value));
    },
  } satisfies Pinner & { files: unknown[]; jsons: unknown[] };
}
