import { z } from "zod";
import { ApiError, failureOf } from "../api";
import { tokenRowSchema } from "../schemas";
import type { TokenRow } from "../types";
import { apiUrl } from "@/lib/backend-url";

const watchlistSchema = z.object({ items: z.array(tokenRowSchema) });
const list = z.object({ tokens: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase())) });

export interface FavoritesApiConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

const seg = encodeURIComponent;

/**
 * The tokens a person has starred. Every request carries the session cookie (never read here); WHOSE stars they are is the
 * session's business, and no request names a person. Anything the API refuses is thrown as an ApiError with its code.
 */
export function createFavoritesApi({ baseUrl, fetch: fetchImpl = (...args) => fetch(...args) }: FavoritesApiConfig) {
  const root = baseUrl.replace(/\/+$/, "");

  async function call(method: string, path: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(root + path, { method, credentials: "include", headers: { accept: "application/json" } });
    } catch {
      throw new ApiError(0, "network", "Could not reach the server.");
    }
    if (!res.ok) throw await failureOf(res);
    return res;
  }

  return {
    /** The starred tokens, newest star first. */
    async list(chain: string): Promise<string[]> {
      const res = await call("GET", `/${seg(chain)}/me/favorites`);
      const parsed = list.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
      return parsed.data.tokens;
    },
    /** The starred tokens as rows of a token table, with their numbers. Every star at once: there is no next page. */
    async watchlist(chain: string): Promise<TokenRow[]> {
      const res = await call("GET", `/${seg(chain)}/me/watchlist`);
      const parsed = watchlistSchema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
      return parsed.data.items;
    },
    async star(chain: string, token: string): Promise<void> {
      await call("PUT", `/${seg(chain)}/me/favorites/${seg(token)}`);
    },
    async unstar(chain: string, token: string): Promise<void> {
      await call("DELETE", `/${seg(chain)}/me/favorites/${seg(token)}`);
    },
  };
}

/** Read at use, not at import, so the API address is whatever the build (or a test) says it is. */
export const getFavoritesApi = () => createFavoritesApi({ baseUrl: apiUrl() });
