import type { z } from "zod";
import {
  candleListSchema,
  commentPageSchema,
  holderListSchema,
  profileSchema,
  holdingListSchema,
  tokenDetailSchema,
  tokenPageSchema,
  tradePageSchema,
  orderPageSchema,
  positionListSchema,
} from "./schemas";
import type { TokenSort } from "./types";

/**
 * Anything that goes wrong talking to the API. `code` is a machine-readable string a component can switch on:
 * the API's own codes (not_found, bad_cursor, ...) plus three of ours: `network` (never reached the server),
 * `load_failed` (a non-JSON error, such as a gateway's HTML page) and `bad_response` (JSON that does not match).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The error for a response that was not a success: the API's own code if it sent one, `load_failed` for anything else (a gateway's HTML page). */
export async function failureOf(res: Response): Promise<ApiError> {
  let code = "load_failed";
  let message = "The server could not answer.";
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string") message = body.message;
  } catch {
    /* not JSON: keep load_failed */
  }
  return new ApiError(res.status, code, message);
}

export interface ApiConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

interface Signal {
  signal?: AbortSignal;
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";

export function createApi({ baseUrl, fetch: fetchImpl = (...args) => fetch(...args) }: ApiConfig) {
  const root = baseUrl.replace(/\/+$/, "");

  async function get<S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    query: Record<string, string | number | undefined> = {},
    signal?: AbortSignal,
  ): Promise<z.output<S>> {
    const url = new URL(root + path);
    // searchParams encodes the values, so a search for "a&b=c#d" cannot change the query around it.
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    let res: Response;
    try {
      res = await fetchImpl(url, { signal, headers: { accept: "application/json" } });
    } catch (e) {
      // A cancelled request is not a failure: let the caller tell the two apart.
      if (isAbort(e)) throw e;
      throw new ApiError(0, "network", "Could not reach the server.");
    }

    if (!res.ok) throw await failureOf(res);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError(res.status, "bad_response", "The server sent something that is not JSON.");
    }
    const parsed = schema.safeParse(body);
    // Fail here, loudly, rather than let an unexpected shape become NaN or a thrown BigInt inside a component.
    if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
    return parsed.data;
  }

  const seg = encodeURIComponent;
  const tokenPath = (chain: string, address: string) => `/${seg(chain)}/tokens/${seg(address)}`;

  return {
    tokens: (chain: string, o: { sort?: TokenSort; q?: string; cursor?: string; limit?: number } & Signal = {}) =>
      get(`/${seg(chain)}/tokens`, tokenPageSchema, { sort: o.sort, q: o.q, cursor: o.cursor, limit: o.limit }, o.signal),

    token: (chain: string, address: string, o: Signal = {}) => get(tokenPath(chain, address), tokenDetailSchema, {}, o.signal),

    trades: (chain: string, address: string, o: { cursor?: string; limit?: number } & Signal = {}) =>
      get(`${tokenPath(chain, address)}/trades`, tradePageSchema, { cursor: o.cursor, limit: o.limit }, o.signal),

    holders: (chain: string, address: string, o: { limit?: number } & Signal = {}) =>
      get(`${tokenPath(chain, address)}/holders`, holderListSchema, { limit: o.limit }, o.signal),

    /** Every token an address holds, hidden ones included: what someone can withdraw is not the moderator's to hide. */
    holdings: (chain: string, address: string, o: Signal = {}) =>
      get(`/${seg(chain)}/addresses/${seg(address)}/holdings`, holdingListSchema, {}, o.signal),

    /** What an address holds now, with what it cost and what it is worth. Open positions only. */
    positions: (chain: string, address: string, o: Signal = {}) => get(`/${seg(chain)}/addresses/${seg(address)}/positions`, positionListSchema, {}, o.signal),

    /** Every trade an address made, newest first, across all tokens. `cursor` is the `nextCursor` of the page before. */
    orders: (chain: string, address: string, o: { cursor?: string; limit?: number } & Signal = {}) =>
      get(`/${seg(chain)}/addresses/${seg(address)}/orders`, orderPageSchema, { cursor: o.cursor, limit: o.limit }, o.signal),

    /** A token's comments, newest first. `cursor` is the `nextCursor` of the page before. */
    comments: (chain: string, address: string, o: { cursor?: string; limit?: number } & Signal = {}) =>
      get(`${tokenPath(chain, address)}/comments`, commentPageSchema, { cursor: o.cursor, limit: o.limit }, o.signal),

    /** What an address created and holds, with hidden tokens and zero balances left out. An unused address is two empty lists. */
    profile: (chain: string, address: string, o: Signal = {}) => get(`/${seg(chain)}/addresses/${seg(address)}/profile`, profileSchema, {}, o.signal),

    candles: (chain: string, address: string, interval: number, o: { from?: number } & Signal = {}) =>
      get(`${tokenPath(chain, address)}/candles`, candleListSchema, { interval, from: o.from }, o.signal),
  };
}

export type Api = ReturnType<typeof createApi>;

/** NEXT_PUBLIC_ means the value ships to every browser, so it may only ever hold something public: the API's URL. */
export const api = createApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });

/** For code that runs in the browser: the address is read when it is used, so it is whatever the build (or a test) says it is. */
export const getApi = () => createApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });
