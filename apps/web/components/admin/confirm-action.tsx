"use client";

import { UI } from "@vezta/shared";
import { useRef, useState } from "react";
import { explainModerationError } from "@/lib/moderation/explain";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog";

/**
 * A button that asks before it acts. Moderation is seen by everyone the moment it is done, so nothing here runs on the first
 * click: the click opens a question, and only its confirmation calls `run`. It runs once however fast that is clicked. If it
 * fails the question stays open, says why in words, and can be tried again; only success closes it and calls `onDone`.
 */
export function ConfirmAction({
  label,
  title,
  body,
  run,
  onDone,
  variant = "outline",
  confirmLabel = UI.moderation.confirm,
  busyLabel = UI.moderation.hiding,
  disabled = false,
}: {
  label: string;
  title: string;
  body: string;
  run: () => Promise<void>;
  onDone: () => void;
  variant?: "outline" | "ghost";
  /** What the confirming button says, and says while it works. Hiding by default. */
  confirmLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  // A double click must not send twice: state updates after the first click's render, a ref does not wait.
  const running = useRef(false);

  async function confirm() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      await run();
      setOpen(false);
      onDone();
    } catch (e) {
      setProblem(explainModerationError(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setProblem(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size="xs" disabled={disabled}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
        {problem && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {problem}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">{UI.moderation.cancel}</Button>
          </DialogClose>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
