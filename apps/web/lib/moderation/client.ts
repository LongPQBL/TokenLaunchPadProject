import { z } from "zod";
import { ApiError, failureOf } from "../api";
import { healthSchema, reportListSchema } from "../schemas";

export interface ModerationApiConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

const seg = encodeURIComponent;
const reported = z.object({ id: z.string().optional(), alreadyReported: z.boolean().optional() });

/**
 * The moderation actions, and the report anyone signed in may file. Every request is a JSON POST carrying the session cookie
 * (never read here): the API refuses anything else, so a form on another page cannot make a moderator's browser act.
 * Whether a person may do these is the API's decision on every request; the page only decides which buttons to draw.
 */
export function createModerationApi({ baseUrl, fetch: fetchImpl = (...args) => fetch(...args) }: ModerationApiConfig) {
  const root = baseUrl.replace(/\/+$/, "");

  async function post(path: string, body: unknown = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(root + path, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "network", "Could not reach the server.");
    }
    if (!res.ok) throw await failureOf(res);
    return res;
  }

  /** A read that needs the session: the same cookie, and the same refusal (the API's plain 404) for anyone who is not an admin. */
  async function get<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.output<S>> {
    let res: Response;
    try {
      res = await fetchImpl(root + path, { credentials: "include", headers: { accept: "application/json" } });
    } catch {
      throw new ApiError(0, "network", "Could not reach the server.");
    }
    if (!res.ok) throw await failureOf(res);
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
    return parsed.data;
  }

  return {
    health: (chain: string) => get(`/${seg(chain)}/admin/health`, healthSchema),
    reports: (chain: string) => get(`/${seg(chain)}/admin/reports`, reportListSchema),
    async resolveReport(chain: string, id: string): Promise<void> {
      await post(`/${seg(chain)}/admin/reports/${seg(id)}/resolve`);
    },
    /** Gives every token whose metadata was given up on another try. Says how many it moved. */
    async reResolveMetadata(chain: string): Promise<{ count: number }> {
      const res = await post(`/${seg(chain)}/admin/metadata/re-resolve`);
      const parsed = z.object({ count: z.number().int().nonnegative() }).safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
      return parsed.data;
    },
    async hideToken(chain: string, token: string): Promise<void> {
      await post(`/${seg(chain)}/admin/tokens/${seg(token)}/hide`);
    },
    async hideComment(chain: string, id: string): Promise<void> {
      await post(`/${seg(chain)}/admin/comments/${seg(id)}/hide`);
    },
    async banUser(chain: string, address: string): Promise<void> {
      await post(`/${seg(chain)}/admin/users/${seg(address)}/ban`);
    },
    /** `alreadyReported` when this person's earlier report of the token is still open: there is nothing new to say. */
    async report(chain: string, token: string, reason: string): Promise<{ alreadyReported: boolean }> {
      const res = await post(`/${seg(chain)}/tokens/${seg(token)}/report`, { reason });
      const parsed = reported.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
      return { alreadyReported: parsed.data.alreadyReported === true };
    },
  };
}

/** Read at use, not at import, so the API address is whatever the build (or a test) says it is. */
export const getModerationApi = () => createModerationApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });
