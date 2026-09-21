import { cn } from "@/lib/utils";

/** How large the number is drawn: big while it is short, a step smaller each time it outgrows the width the panel has. */
function sizeFor(length: number): string {
  if (length <= 8) return "text-5xl";
  if (length <= 11) return "text-4xl";
  if (length <= 14) return "text-3xl";
  if (length <= 18) return "text-2xl";
  return "text-xl";
}

/**
 * The big number a trade is typed into, with its currency sign beside it: "$ 2". The label names the box for a screen reader
 * (the sign is drawn only, so it is not read twice). The box grows with what is typed and its digits step down in size as it does, so a long number is never cut off, and a
 * phone shows a decimal keypad.
 */
export function AmountInput({
  id,
  label,
  prefix,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-2 font-mono", sizeFor(value.length), className)}>
      {prefix && (
        <span aria-hidden="true" className="text-muted-foreground">
          {prefix}
        </span>
      )}
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        size={Math.max(value.length, 1)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[1ch] max-w-full bg-transparent text-center font-semibold outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}
