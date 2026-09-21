"use client";

import { UI } from "@vezta/shared";
import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/lib/wallet/use-identity";
import { useSiwe } from "@/lib/auth/use-siwe";
import { api } from "@/lib/api";
import { getCommentsApi } from "@/lib/comments/client";
import { liveCommentSchema, mergeComments, newerThan, reachesBack } from "@/lib/comments/live";
import type { Comment } from "@/lib/types";
import type { LiveClient } from "@/lib/ws/client";
import { liveCommentsHiddenSchema } from "@/lib/ws/moderation";
import { useLiveRoom } from "@/lib/ws/use-live-room";
import { HideCommentButton } from "../admin/hide-button";
import { Button } from "../ui/button";
import { CommentForm, type CommentAuthState } from "./comment-form";
import { CommentItem } from "./comment-item";

const PAGE = 30;

/** What is held: the server's first page, whatever was loaded below it, and what arrived live or was posted here. */
interface Held {
  first: Comment[];
  older: Comment[];
  /** Where the next older page starts, or none when nothing is older. */
  cursor?: string;
  live: Comment[];
}

/**
 * A token's comment thread, kept current. It starts from what the server rendered, adds each comment the moment the socket
 * delivers it (and the author's own the moment it is saved), and refetches after a reconnect or when the socket is down.
 * A comment is listed once however many ways it arrives. Everything from the socket is checked before it is drawn.
 */
export function CommentList({
  chain,
  token,
  initial,
  nextCursor,
  now,
  client,
}: {
  chain: string;
  token: string;
  initial: Comment[];
  nextCursor?: string;
  now: number;
  client?: LiveClient;
}) {
  const wanted = token.toLowerCase();
  const [held, setHeld] = useState<Held>({ first: initial, older: [], cursor: nextCursor, live: [] });
  const [clock, setClock] = useState(now);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  // Comments a moderator hid from here. Kept, so a stale copy that arrives later (a retry, an older page) cannot bring one back.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());

  // "2s ago" ages while the page is open. (The first render uses the server's clock, so it matches what was rendered.)
  useEffect(() => {
    const timer = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(timer);
  }, []);

  const refetch = useCallback(async () => {
    const page = await api.comments(chain, token, { limit: PAGE });
    setHeld((prev) =>
      // A short page is the whole thread. A page that does not join up with the last one has left a gap under it. Either way,
      // what was loaded below is not to be trusted: start again from this page.
      page.nextCursor === undefined || !reachesBack(prev.first, page.items)
        ? { first: page.items, older: [], cursor: page.nextCursor, live: newerThan(prev.live, page.items) }
        : { ...prev, first: page.items, live: newerThan(prev.live, page.items) },
    );
  }, [chain, token]);

  useLiveRoom({
    room: `token:${chain}:${wanted}`,
    client,
    refetch,
    onMessage: (message) => {
      const hiddenNow = liveCommentsHiddenSchema.safeParse(message);
      if (hiddenNow.success) {
        if (hiddenNow.data.chain === chain && hiddenNow.data.token === wanted) setGone((prev) => new Set([...prev, ...hiddenNow.data.ids]));
        return;
      }
      const parsed = liveCommentSchema.safeParse(message);
      if (!parsed.success || parsed.data.token !== wanted) return;
      setHeld((prev) => ({ ...prev, live: [...prev.live, parsed.data] }));
    },
  });

  const { address } = useIdentity();
  const siwe = useSiwe();
  const state: CommentAuthState = !address ? "disconnected" : siwe.isSignedIn ? "signed-in" : "signed-out";

  async function post(body: string) {
    const saved = await getCommentsApi().post(chain, token, body);
    setHeld((prev) => ({ ...prev, live: [...prev.live, saved] }));
  }

  async function loadOlder() {
    const from = held.cursor;
    if (!from || loadingOlder) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      const page = await api.comments(chain, token, { cursor: from, limit: PAGE });
      // If a refetch started the thread over while this was on its way, its cursor is no longer this one: drop the answer.
      setHeld((prev) => (prev.cursor === from ? { ...prev, older: [...prev.older, ...page.items], cursor: page.nextCursor } : prev));
    } catch {
      setOlderFailed(true);
    } finally {
      setLoadingOlder(false);
    }
  }

  const comments = mergeComments(held.first, [...held.older, ...held.live]).filter((c) => !gone.has(c.id));

  return (
    <div className="flex flex-col">
      {!(address && siwe.isLoading) && <CommentForm draftKey={`${chain}:${wanted}`} state={state} onSubmit={post} onSignIn={siwe.signIn} />}
      {comments.length === 0 ? (
        <p role="status" className="py-10 text-center text-muted-foreground">
          {UI.comments.empty}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              now={clock}
              profileHref={`/${chain}/profile/${comment.author}`}
              actions={<HideCommentButton chain={chain} id={comment.id} onHidden={(id) => setGone((prev) => new Set(prev).add(id))} />}
            />
          ))}
        </ul>
      )}
      {held.cursor && (
        <div className="flex flex-col items-center gap-2 py-3">
          <Button variant="outline" size="sm" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {UI.comments.loadMore}
          </Button>
          {olderFailed && (
            <p role="alert" className="text-sm text-destructive">
              {UI.errors.loadFailed}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
