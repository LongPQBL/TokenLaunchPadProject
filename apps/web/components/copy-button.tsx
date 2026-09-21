"use client";

import { UI } from "@vezta/shared";
import { useState } from "react";
import { Button } from "./ui/button";

/** Copies a piece of text (an address) to the clipboard and says so for two seconds. A refusal by the browser is not an error: the text is on screen. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* copy it by hand */
    }
  }
  return (
    <Button size="xs" variant="outline" onClick={() => void copy()}>
      {copied ? UI.fund.copied : UI.fund.copy}
    </Button>
  );
}
