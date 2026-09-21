/** Which way a profit or loss went: a gain, a loss, or neither (nothing to colour). */
export const pnlDirection = (n: bigint): "up" | "down" | "flat" => (n > 0n ? "up" : n < 0n ? "down" : "flat");

/** The colour that goes with it: the buy green for a gain and the sell red for a loss, the quiet colour for neither. */
export const pnlTone = (d: "up" | "down" | "flat") => (d === "up" ? "text-buy" : d === "down" ? "text-sell" : "text-muted-foreground");
