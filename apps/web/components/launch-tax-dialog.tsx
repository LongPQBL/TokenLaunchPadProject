"use client";

import { UI } from "@vezta/shared";
import { cloneElement, useState, type MouseEvent, type ReactElement } from "react";
import { formatMultiplier } from "@/lib/format";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

/** From this rate up, a buy has to be confirmed. Below it the tax is a fee, not a trap. */
const CONFIRM_FROM_BPS = 1_000n;

/** The buy button: any element whose click is the purchase. Its handler takes no argument, so the guard can run it later. */
type ClickableChild = ReactElement<{ onClick?: () => void }>;

/**
 * Wraps the buy button. Inside the launch-tax window a one-click buy can cost fifty times the price, so from 10% up
 * the click opens a confirmation stating the multiplier instead of buying. The confirmation is per click, never
 * remembered: the tax falls every second, so an earlier "yes" would authorise a price the person never saw. Under
 * 10% the child is untouched. The buy itself is the child's own onClick, run only on confirmation.
 */
export function LaunchTaxGuard({ taxBps, multiplier, children }: { taxBps: bigint; multiplier: number; children: ClickableChild }) {
  const [open, setOpen] = useState(false);
  const guarded = taxBps >= CONFIRM_FROM_BPS;
  const buy = children.props.onClick;

  // The same tree at every tax level, so the button is not remounted (and does not lose focus) when the tax crosses 10%.
  const guardedChild = cloneElement(children, {
    onClick: (event?: MouseEvent<HTMLElement>) => {
      if (!guarded) return buy?.();
      event?.preventDefault();
      setOpen(true);
    },
  } as { onClick: () => void });

  return (
    <>
      {guardedChild}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{UI.token.launchTaxDialog.title}</DialogTitle>
          <DialogDescription>{UI.token.launchTaxDialog.body(`${Number(taxBps) / 100}%`, formatMultiplier(multiplier))}</DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">{UI.token.launchTaxDialog.cancel}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                buy?.();
              }}
            >
              {UI.token.launchTaxDialog.confirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
