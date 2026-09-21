"use client";

import { UI } from "@vezta/shared";
import { useStars } from "@/lib/favorites/use-favorites";
import { cn } from "@/lib/utils";

/** A token's star: filled when it is on the account, pressed to add or remove it. Draws nothing outside a FavoritesProvider. */
export function FavoriteStar({ token, label }: { token: string; label: string }) {
  const stars = useStars();
  if (!stars) return null;
  const on = stars.starred.has(token.toLowerCase());
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={UI.favorites.star(label)}
      onClick={() => void stars.toggle(token.toLowerCase())}
      className={cn(
        "inline-flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on && "text-primary hover:text-primary",
      )}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />
      </svg>
    </button>
  );
}
