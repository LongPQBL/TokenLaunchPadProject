import { EthIcon } from "./create/icons";

/**
 * The small brand mark for a chain slug, wherever a chain is named next to a token: the detail page's header and
 * the create form's preview. Sepolia is Ethereum's own testnet, so it draws the same diamond; a slug this app has
 * not deployed to draws nothing rather than guess at a mark.
 */
export function ChainIcon({ chain, className }: { chain: string; className?: string }) {
  if (chain === "sepolia") return <EthIcon className={className} />;
  return null;
}
