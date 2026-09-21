import { safeHttpUrl } from "@vezta/shared";
import { cn } from "@/lib/utils";

/**
 * A token's picture, or a lettered placeholder. The URL is written by the token's author, so it is scheme-checked
 * (http/https only) before it reaches an attribute, and the referrer is withheld so the image host learns nothing
 * about who is looking. A token with no picture, or a picture that fails the check, shows the placeholder.
 */
export function TokenImage({ src, alt, initial, className }: { src?: string; alt: string; initial: string; className?: string }) {
  const safe = safeHttpUrl(src);
  if (safe) {
    // A plain <img>: the image host is a deploy-time setting, so next/image's allow-list cannot be written yet.
    return <img src={safe} alt={alt} referrerPolicy="no-referrer" loading="lazy" className={cn("shrink-0 bg-secondary object-cover", className)} />;
  }
  return (
    <div
      data-testid="token-image-placeholder"
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center bg-secondary font-mono text-muted-foreground", className)}
    >
      {initial.slice(0, 1).toUpperCase()}
    </div>
  );
}
