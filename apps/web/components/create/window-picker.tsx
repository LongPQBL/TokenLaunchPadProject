"use client";

import { ANTI_SNIPER_WINDOWS, UI } from "@vezta/shared";
import { useId } from "react";

/**
 * The launch-tax window, as the four choices the contract accepts. The warning is not decoration: the creator pays the
 * tax on their own buys too, and that is what people forget.
 */
export function WindowPicker({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={`${name}-legend`} className="text-sm font-medium">
        {UI.create.window.title}
      </legend>
      <p className="text-xs text-muted-foreground">{UI.create.window.help}</p>
      <div role="radiogroup" aria-labelledby={`${name}-legend`} className="flex flex-wrap gap-2">
        {ANTI_SNIPER_WINDOWS.map((seconds) => (
          <label
            key={seconds}
            className={`flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm ${value === seconds ? "border-primary text-primary" : "border-border"}`}
          >
            <input type="radio" name={name} checked={value === seconds} onChange={() => onChange(seconds)} />
            {UI.create.window.options[seconds]}
          </label>
        ))}
      </div>
      <p className="text-xs text-warning">{UI.create.window.warning}</p>
    </fieldset>
  );
}
