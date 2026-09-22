"use client";

import { NetworkBase, NetworkRobinhood, NetworkSolana } from "@web3icons/react";
import { UI } from "@vezta/shared";
import { useId, useState } from "react";
import { ChainIcon, NetworkBadge } from "@/components/chain-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const COMING_SOON = [
  { key: "base", label: "Base", Icon: NetworkBase },
  { key: "robinhood", label: "Robinhood", Icon: NetworkRobinhood },
  { key: "solana", label: "Solana", Icon: NetworkSolana },
] as const;

/** A small downward chevron, marking that the box opens to more options. */
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Which chain the token launches on: collapsed to the chosen chain until opened, the same w-40 width as the pool
 * pair boxes it sits beside (see PairPicker). It opens onto the one chain this app is actually deployed to today,
 * plain rather than highlighted since it is the only real choice, plus the chains people ask about most, shown
 * dimmed until they are wired up. Nothing is chosen by this: like the pool pair picker, it only says which chain
 * it is.
 */
export function ChainPicker({ chain, chainName }: { chain: string; chainName: string }) {
  const name = useId();
  const [open, setOpen] = useState(false);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={`${name}-legend`} className="text-sm font-medium">
        {UI.create.chain.title}
      </legend>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex w-40 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
          >
            <ChainIcon chain={chain} className="size-6 shrink-0" />
            <span className="flex-1 truncate text-left">{chainName}</span>
            <ChevronIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-40 p-1">
          <div role="radiogroup" aria-labelledby={`${name}-legend`} className="flex flex-col gap-1">
            <label onClick={() => setOpen(false)} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold hover:bg-secondary">
              <input type="radio" name={name} checked readOnly className="sr-only" />
              <ChainIcon chain={chain} className="size-6 shrink-0" />
              {chainName}
            </label>
            {COMING_SOON.map(({ key, label, Icon }) => (
              <label key={key} className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-2 opacity-40">
                <input type="radio" name={name} disabled className="sr-only" />
                <NetworkBadge icon={Icon} className="size-6 shrink-0" />
                <span className="flex flex-col text-left leading-tight">
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs font-normal text-muted-foreground">{UI.create.chain.comingSoon}</span>
                </span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </fieldset>
  );
}
