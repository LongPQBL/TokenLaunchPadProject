export interface ChainConfig {
  slug: string;
  chainId: number;
  name: string;
  explorerUrl: string;
  quoteSymbol: string;
  quoteDecimals: number;
  isTestnet: boolean;
  /** How Uniswap's own URLs name this chain (app.uniswap.org/swap?chain=<this>). */
  uniswapSlug: string;
  /** A Chainlink ETH/USD price feed on this chain, read on chain so no outside service is trusted. Absent: no dollar amounts. */
  usdFeed?: `0x${string}`;
}

/** Adding a chain is adding an entry here plus a deployments/<slug>.json. Nothing else. */
export const CHAINS: Record<string, ChainConfig> = {
  sepolia: {
    slug: "sepolia",
    chainId: 11155111,
    name: "Sepolia",
    explorerUrl: "https://sepolia.etherscan.io",
    quoteSymbol: "ETH",
    quoteDecimals: 18,
    isTestnet: true,
    uniswapSlug: "sepolia",
    // Chainlink ETH / USD on Sepolia.
    usdFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  },
};

/**
 * The slug comes straight from a URL segment, so it is hostile input. `CHAINS[slug]` alone would
 * resolve "constructor" or "toString" to a member inherited from Object.prototype and treat it as
 * a chain, hence the own-property check.
 */
export const chainBySlug = (slug: string): ChainConfig | undefined =>
  Object.hasOwn(CHAINS, slug) ? CHAINS[slug] : undefined;

export const chainSlugById = (id: number): string | undefined =>
  Object.values(CHAINS).find((c) => c.chainId === id)?.slug;
