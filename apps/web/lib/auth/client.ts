import { z } from "zod";
import { ApiError } from "../api";

const challenge = z.object({ message: z.string(), nonce: z.string() });
const address = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

export interface AuthApiConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

/**
 * Talks to the API's sign-in endpoints. Every request carries the session cookie (credentials: "include"): the API and
 * the site are on one registrable domain, and the cookie is HttpOnly, so this code never sees it and never stores it.
 */
export function createAuthApi({ baseUrl, fetch: fetchImpl = (...args) => fetch(...args) }: AuthApiConfig) {
  const root = baseUrl.replace(/\/+$/, "");

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetchImpl(root + path, { ...init, credentials: "include", headers: { accept: "application/json", ...init.headers } });
    } catch {
      throw new ApiError(0, "network", "Could not reach the server.");
    }
  }

  async function failure(res: Response): Promise<ApiError> {
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

  async function json<S extends z.ZodTypeAny>(res: Response, schema: S): Promise<z.output<S>> {
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
    return parsed.data;
  }

  return {
    async nonce(forAddress: string) {
      const res = await call(`/auth/nonce?${new URLSearchParams({ address: forAddress })}`);
      if (!res.ok) throw await failure(res);
      return json(res, challenge);
    },

    async verify(message: string, signature: string) {
      const res = await call("/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
      if (!res.ok) throw await failure(res);
      return json(res, address);
    },

    /** The signed-in address, or undefined when there is no session. Having no session is an answer, not an error. */
    async me(): Promise<string | undefined> {
      const res = await call("/me");
      if (res.status === 401) return undefined;
      if (!res.ok) throw await failure(res);
      return (await json(res, address)).address;
    },

    async logout(): Promise<void> {
      const res = await call("/auth/logout", { method: "POST" });
      if (!res.ok) throw await failure(res);
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;

/** Read at use, not at import, so the API address is whatever the build (or a test) says it is. */
export const getAuthApi = () => createAuthApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });
