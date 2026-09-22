"use client";

import { UI } from "@vezta/shared";
import { useId } from "react";
import { ChainIcon } from "@/components/chain-icon";
import { cn } from "@/lib/utils";
import { BaseIcon, RobinhoodIcon, SolanaIcon } from "./icons";

const COMING_SOON = [
  { key: "base", label: "Base", Icon: BaseIcon },
  { key: "robinhood", label: "Robinhood", Icon: RobinhoodIcon },
  { key: "solana", label: "Solana", Icon: SolanaIcon },
] as const;

/**
 * Which chain the token launches on: the one chain this app is actually deployed to today, plus the chains people
 * ask about most, shown dimmed until they are wired up. Nothing is chosen by this: like the pool pair picker, it
 * only says which chain it is.
 */
export function ChainPicker({ chain, chainName }: { chain: string; chainName: string }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={`${name}-legend`} className="text-sm font-medium">
        {UI.create.chain.title}
      </legend>
      <div role="radiogroup" aria-labelledby={`${name}-legend`} className="flex flex-col gap-2">
        <label className="flex items-center gap-3 border border-primary bg-primary/10 px-4 py-3 text-sm font-semibold">
          <input type="radio" name={name} checked readOnly className="sr-only" />
          <ChainIcon chain={chain} className="size-6 shrink-0" />
          {chainName}
        </label>
        {COMING_SOON.map(({ key, label, Icon }) => (
          <label key={key} className={cn("flex cursor-not-allowed items-center gap-3 border border-border px-4 py-3 text-sm font-semibold opacity-40")}>
            <input type="radio" name={name} disabled className="sr-only" />
            <Icon className="size-6 shrink-0" />
            <span className="flex flex-col leading-tight">
              {label}
              <span className="text-xs font-normal text-muted-foreground">{UI.create.chain.comingSoon}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
