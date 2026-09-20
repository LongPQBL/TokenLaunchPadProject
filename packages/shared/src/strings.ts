/**
 * Every user-facing string in the product. One module so a second language is a second object,
 * not an excavation through components (spec §2.5).
 */
export const UI = {
  nav: { create: "Create token", search: "Search tokens" },
  // Named after the chain it is on, so a second testnet never says "SEPOLIA".
  badge: { testnet: (chainName: string) => `${chainName.toUpperCase()} TESTNET` },
  // Until the create flow is built the header button still has to lead somewhere real.
  create: { soon: "Token creation is coming soon." },
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
    launchTaxBanner: (multiplier: string, countdown: string) =>
      `Launch protection is on: buying now costs ${multiplier}× the normal price. It ends in ${countdown}.`,
    launchTaxDialog: {
      title: "Launch tax is active",
      body: (percent: string, multiplier: string) =>
        `A ${percent} launch tax applies to buys right now, so this purchase costs ${multiplier}× the normal price. The tax falls every second until the window ends. Waiting is cheaper.`,
      confirm: "Buy anyway",
      cancel: "Cancel",
    },
    creator: "creator",
    marketCap: "mcap",
    price: "price",
    trades: (n: number) => `${n} ${n === 1 ? "trade" : "trades"}`,
    side: { buy: "Buy", sell: "Sell" },
    columns: {
      rank: "#",
      type: "Type",
      amount: "Amount",
      value: "Value",
      trader: "Trader",
      time: "Time",
      holder: "Holder",
      balance: "Balance",
      share: "Share",
    },
    commentsSoon: "Comments are coming soon.",
    noTrades: "No trades yet.",
    noHolders: "No holders yet.",
  },
  wallet: {
    connect: "Connect wallet",
    connectTitle: "Connect a wallet",
    noWallet: "No wallet found. Install a browser wallet such as MetaMask, then reload this page.",
    disconnect: "Disconnect",
    switchTo: (chainName: string) => `Switch to ${chainName}`,
    wrongNetwork: (chainName: string) => `Your wallet is on another network. Switch to ${chainName} to continue.`,
    notConfigured: "Trading is not configured for this deployment.",
  },
  errors: {
    notFound: "Token not found.",
    loadFailed: "Could not load this. Please try again in a moment.",
  },
} as const;
