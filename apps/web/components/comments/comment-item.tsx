import { neutraliseBidi } from "@vezta/shared";
import { shortAddress, formatRelativeTime } from "@/lib/format";
import type { Comment } from "@/lib/types";
import { TokenImage } from "../token-image";

/**
 * One comment. Its text and its author's name are written by strangers, so both go on the page as text (React escapes
 * them; nothing here is ever markup and nothing is turned into a link), direction controls are removed so they cannot
 * reverse what follows, a long unbroken word is broken rather than allowed to widen the page, and the body sets its own
 * direction (`dir="auto"`) so a right-to-left comment reads properly without touching the layout around it.
 */
export function CommentItem({ comment, now }: { comment: Comment; now: number }) {
  const name = comment.username ? neutraliseBidi(comment.username) : shortAddress(comment.author);
  return (
    <li data-testid="comment-item" className="flex gap-3 py-3">
      <TokenImage src={comment.avatarUrl} alt="" initial={name.replace(/^0x/, "") || "?"} className="size-8 rounded-full text-xs" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span data-testid="comment-author" className={comment.username ? "min-w-0 break-all font-medium text-foreground" : "font-mono"}>
            {name}
          </span>
          <time>{formatRelativeTime(comment.createdAt, now)}</time>
        </div>
        <p data-testid="comment-body" dir="auto" className="whitespace-pre-wrap break-all text-sm">
          {neutraliseBidi(comment.body)}
        </p>
      </div>
    </li>
  );
}
