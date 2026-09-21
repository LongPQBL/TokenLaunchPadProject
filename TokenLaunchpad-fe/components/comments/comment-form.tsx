"use client";

import { commentLength, MAX_COMMENT_CHARS, UI } from "@vezta/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { readDraft, writeDraft } from "@/lib/comments/draft";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

export type CommentAuthState = "disconnected" | "signed-out" | "signed-in";

/** What to tell someone whose comment was refused. The server's own text is never shown: only the code is read. */
function explain(error: unknown): string {
  const e = UI.comments.errors;
  if (!(error instanceof ApiError)) return e.generic;
  switch (error.code) {
    case "banned":
      return e.banned;
    case "rate_limited":
      return e.rateLimited;
    case "bad_comment":
      return e.tooLong;
    case "not_found":
      return e.hiddenToken;
    case "network":
      return e.network;
    default:
      return e.generic;
  }
}

/**
 * The box for a new comment. Who may write is a matter of state, not of hiding the button: someone with no wallet, or a
 * wallet with no session, is told what to do instead. What is typed survives the tab being switched (it is kept per
 * token, in storage that may not exist), and survives a refusal, so a rate limit never costs anyone their words.
 */
export function CommentForm({
  draftKey,
  state,
  onSubmit,
  onSignIn,
}: {
  draftKey: string;
  state: CommentAuthState;
  onSubmit: (body: string) => Promise<void>;
  onSignIn: () => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [problem, setProblem] = useState<string>();
  // A double click must not send twice: state updates after the first click's render, a ref does not wait.
  const busy = useRef(false);

  // Read after mount, not while rendering: the server has no storage, and the first render must match what it sent.
  useEffect(() => setText(readDraft(draftKey)), [draftKey]);

  if (state === "disconnected") return <p className="py-3 text-sm text-muted-foreground">{UI.comments.connectPrompt}</p>;

  if (state === "signed-out") {
    return (
      <div className="flex flex-col gap-2 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{UI.comments.signInPrompt}</p>
          <Button
            size="sm"
            disabled={signingIn}
            onClick={async () => {
              setSigningIn(true);
              try {
                await onSignIn();
              } catch (e) {
                setProblem(explain(e));
              } finally {
                setSigningIn(false);
              }
            }}
          >
            {UI.comments.signIn}
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>
    );
  }

  const length = commentLength(text);
  const tooLong = length > MAX_COMMENT_CHARS;
  const canPost = length > 0 && !tooLong && !sending;

  async function submit() {
    if (busy.current || !canPost) return;
    busy.current = true;
    setSending(true);
    setProblem(undefined);
    try {
      await onSubmit(text.trim());
      setText("");
      writeDraft(draftKey, "");
    } catch (e) {
      setProblem(explain(e)); // the words stay in the box
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label={UI.comments.label}
        placeholder={UI.comments.placeholder}
        value={text}
        rows={3}
        dir="auto"
        onChange={(e) => {
          setText(e.target.value);
          writeDraft(draftKey, e.target.value);
        }}
        className="w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <div className="flex items-center justify-between gap-3">
        <span className={cn("font-mono text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
          {UI.comments.counter(length, MAX_COMMENT_CHARS)}
        </span>
        <Button type="submit" size="sm" disabled={!canPost}>
          {sending ? UI.comments.posting : UI.comments.submit}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </form>
  );
}
