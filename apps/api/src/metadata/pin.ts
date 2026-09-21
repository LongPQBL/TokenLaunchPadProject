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
const PINATA_UPLOADS = "https://uploads.pinata.cloud/v3/files";

/**
 * Pins through Pinata's Files API (v3), which is what a key made in Pinata's dashboard today is scoped for: the older
 * pinFileToIPFS / pinJSONToIPFS endpoints answer such a key with 403 NO_SCOPES_FOUND. Everything is pinned to the PUBLIC network,
 * since the CID goes on chain in an ipfs:// URI that anyone has to be able to read. The key lives only here, in the API's
 * environment. Whatever goes wrong is reported as a PinError with a fixed message: the service's own error text and the
 * underlying network error can carry the key or account details, and none of it belongs in a response or a log line.
 */
export function pinataPinner(jwt: string, fetchImpl: typeof fetch = fetch, timeoutMs = 30_000): Pinner {
  async function upload(file: Blob, name: string): Promise<string> {
    const form = new FormData();
    form.append("file", file, name);
    form.append("network", "public");
    form.append("cid_version", "v1");
    form.append("name", name);
    let res: Response;
    try {
      res = await fetchImpl(PINATA_UPLOADS, {
        method: "POST",
        body: form,
        headers: { authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PinError();
    }
    if (!res.ok) throw new PinError(res.status);
    let cid: unknown;
    try {
      cid = ((await res.json()) as { data?: { cid?: unknown } }).data?.cid;
    } catch {
      throw new PinError(res.status);
    }
    if (typeof cid !== "string" || !CID.test(cid)) throw new PinError(res.status);
    return cid;
  }

  return {
    pinFile(bytes, name, contentType) {
      return upload(new Blob([new Uint8Array(bytes)], { type: contentType }), name);
    },
    // A document is a file of its own: its CID is the document's, and a gateway serves it as it is.
    pinJson(value, name) {
      return upload(new Blob([JSON.stringify(value)], { type: "application/json" }), name);
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
