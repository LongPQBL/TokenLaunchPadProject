"use client";

import { UI } from "@vezta/shared";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DiscoverView, TokenListItem, TokenSort } from "@/lib/types";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";
import { TokenImage } from "./token-image";

/** Asked of the API before the prefix filter narrows it, so there is still headroom left for MAX_SUGGESTIONS real prefix matches
 * even when most of what a substring search turns up does not start with what was typed. */
const SUGGEST_LIMIT = 20;
const MAX_SUGGESTIONS = 8;
const DEBOUNCE_MS = 200;

/**
 * A plain GET form to the chain's page: searching needs no script, and the query lands in the URL where it can be shared. The current
 * sort and view are carried along; the defaults are left out so the URL stays clean.
 *
 * Alongside it, a dropdown of tokens whose name or ticker starts with what has been typed so far, narrowing as more is typed and gone
 * once nothing does. Picking one goes straight to its page. Enter with nothing picked still submits the plain search, as before.
 */
export function SearchBox({ chain, sort, q, view = "table" }: { chain: string; sort: TokenSort; q: string; view?: DiscoverView }) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState(q);
  const [suggestions, setSuggestions] = useState<TokenListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounced = useDebounced(text, DEBOUNCE_MS);
  // Counts each query asked of the API, so an answer that arrives after a later one was asked is dropped, not shown out of order.
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed === "") {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const asked = ++latest.current;
    void (async () => {
      try {
        const page = await api.tokens(chain, { q: trimmed, limit: SUGGEST_LIMIT });
        if (asked !== latest.current) return;
        const lower = trimmed.toLowerCase();
        const matches = page.items
          .filter((t) => t.name?.toLowerCase().startsWith(lower) || t.ticker?.toLowerCase().startsWith(lower))
          .slice(0, MAX_SUGGESTIONS);
        setSuggestions(matches);
        setActiveIndex(-1);
        setOpen(true);
      } catch {
        // A search suggestion that fails to load is not worth alarming anyone over: the plain search still works.
        if (asked === latest.current) {
          setSuggestions([]);
          setOpen(false);
        }
      }
    })();
  }, [chain, debounced]);

  function pick(token: TokenListItem) {
    setOpen(false);
    router.push(`/${chain}/token/${token.address}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(suggestions[activeIndex]!);
    }
  }

  const showEmpty = open && debounced.trim() !== "" && suggestions.length === 0;
  const showList = open && (suggestions.length > 0 || showEmpty);
  const listboxId = `${id}-suggestions`;
  const optionId = (i: number) => `${listboxId}-${i}`;

  return (
    <form
      role="search"
      method="get"
      action={`/${chain}`}
      className="relative min-w-0 flex-1"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {sort !== "new" && <input type="hidden" name="sort" value={sort} />}
      {view === "grid" && <input type="hidden" name="view" value="grid" />}
      <input
        type="search"
        name="q"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        autoComplete="off"
        maxLength={64}
        placeholder={UI.nav.search}
        aria-label={UI.nav.search}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        className="h-9 w-full border border-input-border bg-input-bg px-3 font-mono text-sm outline-none focus:border-input-focus"
      />
      <button type="submit" className="sr-only">
        Search
      </button>
      {showList && (
        <ul id={listboxId} role="listbox" aria-label={UI.nav.search} className="absolute z-20 mt-1 w-full border border-border bg-background shadow-lg">
          {suggestions.map((t, i) => {
            const title = t.name ?? t.ticker ?? t.address;
            return (
              <li
                key={t.address}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                // Without this, the click's own mousedown blurs the input first (the browser's default focus handling),
                // which closes the list before the click lands on an option that is no longer there.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
                className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 text-sm", i === activeIndex ? "bg-accent" : "hover:bg-accent")}
              >
                <TokenImage src={t.imageUrl} alt={title} initial={t.ticker ?? title} className="size-6 shrink-0 rounded-full text-xs" />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {t.ticker && <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.ticker}</span>}
              </li>
            );
          })}
          {showEmpty && <li className="px-3 py-2 text-sm text-muted-foreground">{UI.nav.searchNoResults}</li>}
        </ul>
      )}
    </form>
  );
}
