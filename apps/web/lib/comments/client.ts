import { ApiError, failureOf } from "../api";
import { commentSchema } from "../schemas";
import type { Comment } from "../types";

export interface CommentsApiConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

/**
 * Writes comments. Only the text is sent: who is speaking is the session cookie's business (sent with the request, never
 * read here), and the API takes no other field from the body. Reading comments is `api.comments`, which needs no session.
 */
export function createCommentsApi({ baseUrl, fetch: fetchImpl = (...args) => fetch(...args) }: CommentsApiConfig) {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    /** The saved comment, as a list would show it. Anything the API refuses is thrown as an ApiError carrying its code. */
    async post(chain: string, token: string, body: string): Promise<Comment> {
      let res: Response;
      try {
        res = await fetchImpl(`${root}/${encodeURIComponent(chain)}/tokens/${encodeURIComponent(token)}/comments`, {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ body }),
        });
      } catch {
        throw new ApiError(0, "network", "Could not reach the server.");
      }
      if (!res.ok) throw await failureOf(res);
      const parsed = commentSchema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
      return parsed.data;
    },
  };
}

/** Read at use, not at import, so the API address is whatever the build (or a test) says it is. */
export const getCommentsApi = () => createCommentsApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });
