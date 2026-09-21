import type { CommentView } from "../queries/comments.js";

export type CommentPublisher = (chain: string, token: string, comment: CommentView) => Promise<void>;

/**
 * Tells the token's live room about a new comment, on the channel every viewer of that token already listens to. Comments are
 * not chain events, so the API says so itself (the watcher only follows the chain). It is best-effort: a comment is saved
 * whether or not anyone is told live, and a Redis outage must never fail the request that saved it. Nothing hidden is ever
 * passed here: a comment is published only when it is written, and a hidden token, a banned author and a hidden comment
 * never get that far.
 */
export function createCommentPublisher(
  publish: ((channel: string, message: string) => Promise<unknown>) | undefined,
  onError: (error: unknown) => void = (e) => console.error(e),
): CommentPublisher {
  return async (chain, token, comment) => {
    if (!publish) return;
    const address = token.toLowerCase();
    try {
      await publish(
        `token:${chain}:${address}`,
        JSON.stringify({
          type: "comment",
          id: comment.id,
          chain,
          token: address,
          author: comment.author,
          ...(comment.username ? { username: comment.username } : {}),
          ...(comment.avatarUrl ? { avatarUrl: comment.avatarUrl } : {}),
          body: comment.body,
          createdAt: comment.createdAt.toString(),
        }),
      );
    } catch (e) {
      onError(e);
    }
  };
}
