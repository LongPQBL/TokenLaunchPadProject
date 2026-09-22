"use client";

import { UI } from "@vezta/shared";
import { useEffect, useState } from "react";
import { ChainIcon } from "@/components/chain-icon";
import { TokenImage } from "@/components/token-image";
import { EyeIcon } from "./icons";

/**
 * A live look at the token card people will see once this is created: the same name, ticker, logo and chain,
 * updated as they are typed. Nothing here is sent; it only reads the form's own state.
 */
export function TokenPreview({ name, ticker, image, chain, chainName }: { name: string; ticker: string; image: File | undefined; chain: string; chainName: string }) {
  const [preview, setPreview] = useState<string>();

  // A preview is a URL the browser keeps a copy behind: one is made for each logo, and let go of when it changes.
  useEffect(() => {
    if (!image) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const shownName = name.trim() || UI.create.preview.namePlaceholder;
  const shownTicker = ticker.trim() ? `$${ticker.trim()}` : UI.create.preview.tickerPlaceholder;

  return (
    <div data-testid="token-preview" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <EyeIcon className="size-4" />
        {UI.create.preview.title}
      </div>
      <div className="flex items-center justify-between gap-3 border border-border bg-card/40 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* The logo is a local blob: URL, not a stranger's link, so it bypasses TokenImage's http(s)-only gate
              (same as ImageDropzone's own preview) rather than being rejected by it. */}
          {preview ? (
            <img src={preview} alt={shownName} className="size-14 shrink-0 rounded-full bg-secondary object-cover" />
          ) : (
            <TokenImage src={undefined} alt={shownName} initial={shownName} className="size-14 shrink-0 rounded-full text-lg" />
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{shownName}</p>
            <p className="truncate font-mono text-sm text-muted-foreground">{shownTicker}</p>
          </div>
        </div>
        <ChainIcon chain={chain} className="size-8 shrink-0" />
        <span className="sr-only">{chainName}</span>
      </div>
    </div>
  );
}
