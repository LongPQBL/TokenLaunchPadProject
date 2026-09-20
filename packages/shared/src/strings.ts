/**
 * Every user-facing string in the product. One module so a second language is a second object,
 * not an excavation through components (spec §2.5).
 */
export const UI = {
  nav: { create: "Create token", search: "Search tokens" },
  // Named after the chain it is on, so a second testnet never says "SEPOLIA".
  badge: { testnet: (chainName: string) => `${chainName.toUpperCase()} TESTNET` },
  discover: {
    tabs: { new: "New", trending: "Trending", progress: "Nearing graduation" },
    empty: "No tokens yet. Be the first to create one.",
    searchEmpty: "No tokens match that search.",
    next: "Next page",
  },
  token: {
    status: { trading: "TRADING", graduating: "GRADUATING…", graduated: "GRADUATED" },
    progress: "Graduation progress",
    collected: (have: string, target: string, symbol: string) => `${have} / ${target} ${symbol} collected`,
    tabs: { trades: "Trades", holders: "Holders", comments: "Comments" },
    tradeOnUniswap: "Trade on Uniswap",
    creator: "creator",
    marketCap: "mcap",
    price: "price",
    trades: (n: number) => `${n} ${n === 1 ? "trade" : "trades"}`,
    noTrades: "No trades yet.",
    noHolders: "No holders yet.",
  },
  errors: {
    notFound: "Token not found.",
    loadFailed: "Could not load this. Please try again in a moment.",
  },
} as const;
