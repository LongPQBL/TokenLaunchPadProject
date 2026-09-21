import { z } from "zod";
import type { Comment } from "../types";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => s.toLowerCase());

/** A comment as the API publishes it to a token's room. Everything from the wire is checked: a malformed message is dropped, never drawn. */
export const liveCommentSchema = z.object({
  type: z.literal("comment"),
  id: z.string().regex(/^\d+$/),
  chain: z.string(),
  token: address,
  author: address,
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
  body: z.string(),
  createdAt: z
    .string()
    .regex(/^\d+$/)
    .transform((s) => BigInt(s)),
});
export type LiveComment = z.output<typeof liveCommentSchema>;

/** Newest first, no comment twice. Comments are numbered as they are written, so the number is the order. The first list wins a tie: it is the server's. */
export function mergeComments(fetched: Comment[], extra: Comment[]): Comment[] {
  const byId = new Map<string, Comment>();
  for (const comment of [...fetched, ...extra]) if (!byId.has(comment.id)) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) => (BigInt(a.id) === BigInt(b.id) ? 0 : BigInt(a.id) < BigInt(b.id) ? 1 : -1));
}

/**
 * What to keep of comments held from before a refetch: only those newer than everything the server just listed. Older ones
 * are the server's to vouch for (a moderator may have hidden one since); newer ones were written while the request was in
 * flight and are not in its answer yet.
 */
export function newerThan(held: Comment[], page: Comment[]): Comment[] {
  if (page.length === 0) return held;
  const newest = page.reduce((max, c) => (BigInt(c.id) > max ? BigInt(c.id) : max), 0n);
  return held.filter((c) => BigInt(c.id) > newest);
}

/**
 * Whether a refreshed first page joins up with the one it replaces. Comments held from further down were fetched by cursor
 * from below the OLD first page, so they are only in step with the new one if the new one still overlaps the old one's
 * range. A burst of new comments pushes it clear of that range, and whatever fell in between is unseen: start over.
 */
export function reachesBack(previous: Comment[], page: Comment[]): boolean {
  if (previous.length === 0 || page.length === 0) return true;
  const newestBefore = previous.reduce((max, c) => (BigInt(c.id) > max ? BigInt(c.id) : max), 0n);
  const oldestNow = page.reduce((min, c) => (BigInt(c.id) < min ? BigInt(c.id) : min), BigInt(page[0]!.id));
  return oldestNow <= newestBefore;
}
