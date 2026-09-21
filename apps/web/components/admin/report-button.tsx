"use client";

import { UI } from "@vezta/shared";
import { useRef, useState } from "react";
import { useSiwe } from "@/lib/auth/use-siwe";
import { getModerationApi } from "@/lib/moderation/client";
import { explainModerationError } from "@/lib/moderation/explain";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog";

/** The most a reason may say. (The box counts UTF-16 units, the server counts characters: this can only be stricter.) */
const MAX_REASON = 280;

/**
 * Lets anyone signed in tell the moderators a token is bad. Drawn only for a signed-in person, since a report is filed as
 * someone. Sends once however fast it is clicked, keeps the words when it fails, and says so if the person had already
 * reported the token.
 */
export function ReportButton({ chain, token }: { chain: string; token: string }) {
  const { isSignedIn } = useSiwe();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [result, setResult] = useState<"sent" | "already">();
  const running = useRef(false);
  if (!isSignedIn) return null;

  async function send() {
    if (running.current || reason.trim() === "") return;
    running.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const { alreadyReported } = await getModerationApi().report(chain, token.toLowerCase(), reason.trim());
      setResult(alreadyReported ? "already" : "sent");
    } catch (e) {
      setProblem(explainModerationError(e)); // the words stay in the box
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
        if (!next) {
          setResult(undefined);
          setProblem(undefined);
          setReason("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs">
          {UI.moderation.report}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{UI.moderation.reportTitle}</DialogTitle>
        <DialogDescription>{UI.moderation.reportBody}</DialogDescription>
        {result ? (
          <>
            <p role="status" className="mt-4 text-sm">
              {result === "sent" ? UI.moderation.reportThanks : UI.moderation.reportAlready}
            </p>
            <div className="mt-5 flex justify-end">
              <DialogClose asChild>
                <Button variant="outline">{UI.moderation.reportClose}</Button>
              </DialogClose>
            </div>
          </>
        ) : (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="report-reason" className="text-sm font-medium">
              {UI.moderation.reportLabel}
            </label>
            <textarea
              id="report-reason"
              value={reason}
              maxLength={MAX_REASON}
              rows={4}
              dir="auto"
              onChange={(e) => setReason(e.target.value)}
              className="w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {problem && (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {UI.moderation.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy || reason.trim() === ""}>
                {busy ? UI.moderation.reportSending : UI.moderation.reportSubmit}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
