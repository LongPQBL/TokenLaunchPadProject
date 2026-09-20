import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, type TokenForm } from "@vezta/shared";
import { ApiError } from "../api";

/** The same limits the API enforces, so a person hears about a bad logo before uploading it. The API still decides. */
export function checkImage(file: File): boolean {
  return file.size > 0 && file.size <= MAX_IMAGE_BYTES && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type);
}

// The URI is about to be written on chain, so what comes back is checked rather than trusted.
const IPFS_URI = /^ipfs:\/\/[A-Za-z0-9]{5,100}$/;

export function createUploader({ baseUrl, fetch: fetchImpl = (...args) => fetch(...args) }: { baseUrl: string; fetch?: typeof fetch }) {
  const root = baseUrl.replace(/\/+$/, "");

  /** Sends the logo and the form to the API and returns the metadata URI. Needs a session: the cookie goes along. */
  return async function upload(form: TokenForm, image: File): Promise<string> {
    const body = new FormData();
    body.append("name", form.name);
    body.append("ticker", form.ticker);
    body.append("description", form.description);
    body.append("antiSniperWindow", String(form.antiSniperWindow));
    for (const key of ["website", "twitter", "telegram"] as const) {
      const value = form[key];
      if (value) body.append(key, value);
    }
    body.append("image", image);

    let res: Response;
    try {
      res = await fetchImpl(`${root}/metadata`, { method: "POST", body, credentials: "include" });
    } catch {
      throw new ApiError(0, "network", "Could not reach the server.");
    }
    if (!res.ok) {
      let code = "load_failed";
      let message = "The server could not answer.";
      try {
        const err = (await res.json()) as { error?: unknown; message?: unknown };
        if (typeof err.error === "string") code = err.error;
        if (typeof err.message === "string") message = err.message;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, code, message);
    }
    const uri = ((await res.json().catch(() => undefined)) as { metadataURI?: unknown } | undefined)?.metadataURI;
    if (typeof uri !== "string" || !IPFS_URI.test(uri)) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
    return uri;
  };
}

/** Read at use, so the API address is whatever the build (or a test) says it is. */
export const getUploader = () => createUploader({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });
