import { NetworkSepolia } from "@web3icons/react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

type NetworkIconComponent = ComponentType<{ variant?: "mono" | "branded" | "background"; className?: string }>;

/**
 * A @web3icons network mark, circle-cropped to a badge: the "background" variant is a full-bleed square (colour
 * fill plus the chain's own mark), and every chain badge in this app wants the same round shape, so the crop
 * lives here once rather than at each call site.
 */
export function NetworkBadge({ icon: Icon, className }: { icon: NetworkIconComponent; className?: string }) {
  return (
    <span className={cn("inline-block shrink-0 overflow-hidden rounded-full", className)}>
      <Icon variant="background" className="block size-full" />
    </span>
  );
}

/**
 * The real brand mark for a chain slug, wherever a chain is named next to a token: the detail page's header and
 * the create form's preview. Drawn from @web3icons (bundled at build time, so no image is ever fetched and the
 * app's strict img-src CSP — spec §11 — needs no new origin). A slug this app has not deployed to draws nothing
 * rather than guess at a mark.
 */
export function ChainIcon({ chain, className }: { chain: string; className?: string }) {
  if (chain === "sepolia") return <NetworkBadge icon={NetworkSepolia} className={className} />;
  return null;
}
