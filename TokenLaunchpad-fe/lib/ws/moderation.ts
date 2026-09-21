import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => s.toLowerCase());

/** A moderator hid a token. Everything from the wire is checked: a malformed message is dropped, never acted on. */
export const liveTokenHiddenSchema = z.object({
  type: z.literal("token_hidden"),
  chain: z.string(),
  token: address,
});
export type LiveTokenHidden = z.output<typeof liveTokenHiddenSchema>;

/** A moderator hid these comments (one, or everything a banned author wrote on the token). */
export const liveCommentsHiddenSchema = z.object({
  type: z.literal("comments_hidden"),
  chain: z.string(),
  token: address,
  ids: z.array(z.string().regex(/^\d+$/)).min(1).max(1_000),
});
export type LiveCommentsHidden = z.output<typeof liveCommentsHiddenSchema>;
