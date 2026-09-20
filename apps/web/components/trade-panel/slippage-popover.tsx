"use client";

import { UI } from "@vezta/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PRESETS = [50n, 100n, 300n]; // 0.5%, 1%, 3%

const percent = (bps: bigint) => String(Number(bps) / 100);

/** The slippage setting: three presets and a custom percentage. Out-of-range values are refused by the hook, not here. */
export function SlippagePopover({ bps, onChange }: { bps: bigint; onChange: (bps: bigint) => void }) {
  const [custom, setCustom] = useState("");

  function applyCustom(text: string) {
    setCustom(text);
    const value = Number(text);
    if (text.trim() !== "" && Number.isFinite(value) && value > 0) onChange(BigInt(Math.round(value * 100)));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="font-mono">
          {UI.trade.slippage.label(percent(bps))}
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <p className="font-semibold">{UI.trade.slippage.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{UI.trade.slippage.help}</p>
        <div className="mt-3 flex gap-2">
          {PRESETS.map((preset) => (
            <Button key={preset} type="button" size="xs" variant={preset === bps ? "default" : "outline"} aria-pressed={preset === bps} onClick={() => onChange(preset)}>
              {`${percent(preset)}%`}
            </Button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          {UI.trade.slippage.custom}
          <input
            inputMode="decimal"
            value={custom}
            onChange={(e) => applyCustom(e.target.value)}
            className="w-16 border border-border bg-background px-2 py-1 font-mono text-foreground"
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}
