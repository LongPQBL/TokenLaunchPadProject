import { z } from "zod";
import { ApiError, failureOf } from "../api";

const updated = z.object({ address: z.string(), username: z.string().optional(), avatarUrl: z.string().optional() });
export type UpdatedProfile = z.output<typeof updated>;

export interface ProfileApiConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

/**
 * Changes the signed-in person's own profile. Only what is given is sent, and an empty username clears it. The body is a
 * form, sent with no content type of ours so the browser adds the multipart boundary; the session cookie says whose profile
 * it is (nothing in the form does).
 */
export function createProfileApi({ baseUrl, fetch: fetchImpl = (...args) => fetch(...args) }: ProfileApiConfig) {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async update(changes: { username?: string; avatar?: File; removeAvatar?: boolean }): Promise<UpdatedProfile> {
      const form = new FormData();
      if (changes.username !== undefined) form.set("username", changes.username);
      if (changes.avatar) form.set("avatar", changes.avatar);
      else if (changes.removeAvatar) form.set("removeAvatar", "true");

      let res: Response;
      try {
        res = await fetchImpl(`${root}/me`, { method: "PUT", credentials: "include", headers: { accept: "application/json" }, body: form });
      } catch {
        throw new ApiError(0, "network", "Could not reach the server.");
      }
      if (!res.ok) throw await failureOf(res);
      const parsed = updated.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.");
      return parsed.data;
    },
  };
}

/** Read at use, not at import, so the API address is whatever the build (or a test) says it is. */
export const getProfileApi = () => createProfileApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001" });
