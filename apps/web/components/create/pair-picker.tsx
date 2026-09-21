"use client";

import { UI } from "@vezta/shared";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { EthIcon, UsdcIcon } from "./icons";

/**
 * What the token's pool is paired with once it graduates: the chain's own quote (ETH here) is the one choice, and USDC is shown, dimmed,
 * as coming soon. Nothing is chosen by this: the launchpad has one quote today, so the picker only says which it is.
 */
export function PairPicker({ symbol }: { symbol: string }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={`${name}-legend`} className="text-sm font-medium">
        {UI.create.pair.title}
      </legend>
      <div role="radiogroup" aria-labelledby={`${name}-legend`} className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-3 border border-primary bg-primary/10 px-4 py-3 text-sm font-semibold">
          <input type="radio" name={name} checked readOnly className="sr-only" />
          <EthIcon className="size-8 shrink-0" />
          {symbol}
        </label>
        <label className={cn("flex cursor-not-allowed items-center gap-3 border border-border px-4 py-3 text-sm font-semibold opacity-40")}>
          <input type="radio" name={name} disabled className="sr-only" />
          <UsdcIcon className="size-8 shrink-0" />
          <span className="flex flex-col leading-tight">
            USDC
            <span className="text-xs font-normal text-muted-foreground">{UI.create.pair.comingSoon}</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
