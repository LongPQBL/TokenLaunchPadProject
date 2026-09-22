import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { budgetForMaxCost, formatCompactTokens, formatQuote, maxCostWithSlippage } from "@vezta/shared";
import { parseEther, UserRejectedRequestError } from "viem";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBuyQuote } from "@/lib/chain/buy-quote";
import { TradeError } from "@/lib/wallet/types";
import { fakeChain, freshCurve } from "@/test/fake-chain";
import { externalConnector, renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { privateKeyToAccount } from "viem/accounts";
import { SessionContext, type SessionValue } from "@/lib/session/use-session";
import { BuyPanel } from "./buy-panel";

const TOKEN = "0x00000000000000000000000000000000000000b2" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const SLIPPAGE_BPS = 100n; // the default, 1%
const GAS_RESERVE = 250_000n * 1_000_000_000n; // BUY_GAS at the fake chain's 1 gwei

const trade = vi.hoisted(() => ({
  capabilities: { kind: "self-custody", address: undefined, chainId: undefined, canBatch: false, isZeroPrompt: false },
  buyWithEth: vi.fn(),
  sell: vi.fn(),
  approveIfNeeded: vi.fn(),
  createToken: vi.fn(),
}));
vi.mock("@/lib/wallet/use-trade", () => ({ useTrade: () => trade }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  localStorage.clear();
  Object.values(trade).forEach((v) => typeof v === "function" && "mockReset" in v && v.mockReset());
});
afterEach(() => vi.unstubAllEnvs());

async function setup(initial = {}, { connected = true } = {}) {
  const chain = fakeChain(initial);
  const view = renderWithWallet(<BuyPanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
  if (connected) await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { chain, ...view, user: userEvent.setup() };
}

const budgetInput = () => screen.getByLabelText("Amount to spend (ETH)");
const buyButton = () => screen.getByRole("button", { name: "Buy" });

describe("BuyPanel: the quote", () => {
  it("itemises the price, the fee and the total for a typed budget, and estimates the tokens", async () => {
    const { user } = await setup();
    await user.type(budgetInput(), "0.01");
    const q = computeBuyQuote(freshCurve(), 100n, 0n, budgetForMaxCost(parseEther("0.01") - GAS_RESERVE, SLIPPAGE_BPS));

    const table = await screen.findByTestId("cost-breakdown");
    await waitFor(() => expect(within(table).getByText(formatQuote(q.total, 18, 6))).toBeInTheDocument());
    expect(within(table).getByText(formatQuote(q.quoteCost, 18, 6))).toBeInTheDocument();
    expect(within(table).getByText(formatQuote(q.baseFee, 18, 6))).toBeInTheDocument();
    expect(within(table).getByText(new RegExp(formatCompactTokens(q.amount)))).toBeInTheDocument();
    expect(within(table).queryByText("Launch tax")).not.toBeInTheDocument(); // none outside the window
  });

  it("shows the launch tax as its own line inside the window, and the banner above the form", async () => {
    const { user } = await setup({ taxBps: 500n, curve: freshCurve({ antiSniperWindow: 600 }) });
    await user.type(budgetInput(), "0.01");
    const table = await screen.findByTestId("cost-breakdown");
    await waitFor(() => expect(within(table).getByText("Launch tax")).toBeInTheDocument());
    // 5% is a fee, not a trap: the banner needs the tax to be on, not to be huge
    expect(screen.getByRole("status")).toHaveTextContent(/Launch protection is on/);
  });
});

describe("BuyPanel: a wallet with no ETH", () => {
  const empty = { [TEST_USER.toLowerCase()]: 0n };

  it("says how to add ETH, with the address, above a Buy button that is off, and gives a reason in words", async () => {
    const { user } = await setup({ balances: empty });
    await user.type(budgetInput(), "0.01");
    expect(await screen.findByText(/holds no ETH/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(TEST_USER, "i"))).toBeInTheDocument();
    expect(buyButton()).toBeDisabled();
    expect(screen.getByText("Add ETH first")).toBeInTheDocument();
    expect(screen.queryByText("Not enough ETH for this purchase and network fees.")).toBeNull(); // not the vague one
  });

  it("says nothing of funding to someone who has ETH", async () => {
    await setup();
    await screen.findByLabelText("Amount to spend (ETH)");
    expect(screen.queryByText(/holds no ETH/i)).toBeNull();
    expect(screen.queryByText("Add ETH first")).toBeNull();
  });

  it("still tells someone with a little ETH that it is not enough, in the old words", async () => {
    const { user } = await setup({ balances: { [TEST_USER.toLowerCase()]: parseEther("0.0001") } });
    await user.type(budgetInput(), "0.05");
    expect(await screen.findByText("Not enough ETH for this purchase and network fees.")).toBeInTheDocument();
    expect(screen.queryByText(/holds no ETH/i)).toBeNull();
  });
});

describe("BuyPanel: buying", () => {
  it("sends maxQuoteCost = total x (1 + slippage) + 1 wei, for exactly the tokens quoted", async () => {
    trade.buyWithEth.mockResolvedValue({ hash: HASH, tokenAmount: 1n, quoteAmount: 1n, fee: 0n, launchTax: 0n });
    const { user } = await setup();
    await user.type(budgetInput(), "0.01");
    const q = computeBuyQuote(freshCurve(), 100n, 0n, budgetForMaxCost(parseEther("0.01") - GAS_RESERVE, SLIPPAGE_BPS));
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());

    expect(trade.buyWithEth).toHaveBeenCalledWith({ token: TOKEN, amount: q.amount, maxQuoteCost: maxCostWithSlippage(q.total, 100n) });
  });

  it("reports what the Trade event says was bought, not what was asked for", async () => {
    // The curve clipped the purchase: asked for far more than the 12.3 tokens it returns.
    trade.buyWithEth.mockResolvedValue({ hash: HASH, tokenAmount: 12_300n * 10n ** 18n, quoteAmount: 9n * 10n ** 15n, fee: 10n ** 14n, launchTax: 0n });
    const { user } = await setup();
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());

    const result = await screen.findByText(/You bought/);
    expect(result).toHaveTextContent(`You bought ${formatCompactTokens(12_300n * 10n ** 18n)} DEMO for 0.0091 ETH.`);
    expect(within(result.parentElement!).getByRole("link", { name: "View transaction" })).toHaveAttribute("href", expect.stringContaining(HASH));
  });

  it("stays calm when the person declines in their wallet", async () => {
    trade.buyWithEth.mockRejectedValue(new TradeError("user_rejected", "declined", { cause: new UserRejectedRequestError(new Error("no")) }));
    const { user } = await setup();
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());
    await waitFor(() => expect(trade.buyWithEth).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(buyButton()).toBeEnabled();
  });

  it("explains a contract failure in words", async () => {
    const { encodeErrorResult, ContractFunctionRevertedError, BaseError } = await import("viem");
    const { launchpadAbi } = await import("@vezta/abi");
    const data = encodeErrorResult({ abi: launchpadAbi, errorName: "SlippageExceeded" });
    trade.buyWithEth.mockRejectedValue(new BaseError("x", { cause: new ContractFunctionRevertedError({ abi: launchpadAbi, data, functionName: "buyWithEth" }) }));
    const { user } = await setup();
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Price changed. Increase slippage or try again.");
  });

  it("is blocked behind a confirmation from 10% launch tax up, and buys only after it", async () => {
    trade.buyWithEth.mockResolvedValue({ hash: HASH, tokenAmount: 1n, quoteAmount: 1n, fee: 0n, launchTax: 0n });
    const { user } = await setup({ taxBps: 9800n, curve: freshCurve({ antiSniperWindow: 600 }) });
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());
    expect(trade.buyWithEth).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(/×/);
    await user.click(screen.getByRole("button", { name: "Buy anyway" }));
    expect(trade.buyWithEth).toHaveBeenCalledOnce();
  });
});

describe("BuyPanel: slippage", () => {
  it("uses the chosen slippage, and remembers it across a reload", async () => {
    trade.buyWithEth.mockResolvedValue({ hash: HASH, tokenAmount: 1n, quoteAmount: 1n, fee: 0n, launchTax: 0n });
    const first = await setup();
    await first.user.click(screen.getByRole("button", { name: /Slippage 1%/ }));
    await first.user.click(await screen.findByRole("button", { name: "3%" }));
    first.unmount();

    const { user } = await setup();
    expect(await screen.findByRole("button", { name: /Slippage 3%/ })).toBeInTheDocument();
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());
    const q = computeBuyQuote(freshCurve(), 100n, 0n, budgetForMaxCost(parseEther("0.01") - GAS_RESERVE, 300n));
    expect(trade.buyWithEth).toHaveBeenCalledWith(expect.objectContaining({ maxQuoteCost: maxCostWithSlippage(q.total, 300n) }));
  });
});

describe("BuyPanel: what disables the button", () => {
  it("cannot buy when the balance covers the most it might cost but not the gas on top, and says why", async () => {
    const q = computeBuyQuote(freshCurve(), 100n, 0n, budgetForMaxCost(parseEther("0.01") - GAS_RESERVE, SLIPPAGE_BPS));
    const { user } = await setup({ ethBalance: maxCostWithSlippage(q.total, 100n) + 1n });
    await user.type(budgetInput(), "0.01");
    expect(await screen.findByText("Not enough ETH for this purchase and network fees.")).toBeInTheDocument();
    expect(buyButton()).toBeDisabled();
  });

  it("can buy when the balance covers the most it might cost plus gas", async () => {
    const q = computeBuyQuote(freshCurve(), 100n, 0n, budgetForMaxCost(parseEther("0.01") - GAS_RESERVE, SLIPPAGE_BPS));
    const { user } = await setup({ ethBalance: maxCostWithSlippage(q.total, 100n) + 10n ** 15n });
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    expect(screen.queryByText("Not enough ETH for this purchase and network fees.")).not.toBeInTheDocument();
  });

  it("says nothing about the balance before anything is typed, even for an empty wallet", async () => {
    await setup({ ethBalance: 0n });
    await waitFor(() => expect(buyButton()).toBeDisabled());
    expect(screen.queryByText("Not enough ETH for this purchase and network fees.")).not.toBeInTheDocument();
  });

  it("locks the button while a purchase is in flight", async () => {
    let resolve!: (v: unknown) => void;
    trade.buyWithEth.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = await setup();
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());
    await waitFor(() => expect(buyButton()).toBeDisabled());
    expect(screen.getByRole("status")).toHaveTextContent(/Confirm in your wallet/);
    await act(async () => resolve({ hash: HASH, tokenAmount: 1n, quoteAmount: 1n, fee: 0n, launchTax: 0n }));
  });

  it.each(["", "0", "-1", "abc", "0.0", "1e5", ".", "--1"])("disables the button for a budget of %j, without an error message", async (text) => {
    const { user } = await setup();
    if (text) await user.type(budgetInput(), text);
    expect(buyButton()).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Not enough ETH for this purchase and network fees.")).not.toBeInTheDocument();
  });

  // An external wallet pays from its trading wallet: the ETH that pays is the TRADING wallet's, not the main wallet's.
  const TRADING = privateKeyToAccount(`0x${"33".repeat(32)}`);
  async function setupTrading(initial: Record<string, unknown>) {
    const chain = fakeChain(initial);
    const value: SessionValue = { status: "ready", account: TRADING, main: TEST_USER, enable: async () => true };
    const view = renderWithWallet(
      <SessionContext.Provider value={value}>
        <BuyPanel chain="sepolia" token={TOKEN} ticker="DEMO" />
      </SessionContext.Provider>,
      [externalConnector()],
      chain.transport,
    );
    await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
    return { chain, ...view, user: userEvent.setup() };
  }

  it("checks the balance of the wallet that will actually pay: the trading wallet", async () => {
    const q = computeBuyQuote(freshCurve(), 100n, 0n, budgetForMaxCost(parseEther("0.01") - GAS_RESERVE, SLIPPAGE_BPS));
    const enough = maxCostWithSlippage(q.total, 100n) + 10n ** 16n;
    // the main wallet is nearly empty, the trading wallet is full
    const { user } = await setupTrading({ balances: { [TEST_USER.toLowerCase()]: 1n, [TRADING.address.toLowerCase()]: enough } });
    await user.type(budgetInput(), "0.01");
    await waitFor(() => expect(buyButton()).toBeEnabled());
    expect(screen.queryByText("Not enough ETH for this purchase and network fees.")).not.toBeInTheDocument();
  });

  it("and says the trading wallet is short when IT cannot pay, whatever the main wallet holds", async () => {
    const { user } = await setupTrading({ balances: { [TEST_USER.toLowerCase()]: parseEther("50"), [TRADING.address.toLowerCase()]: 1n } });
    await user.type(budgetInput(), "0.01");
    expect(await screen.findByText("Not enough ETH for this purchase and network fees.")).toBeInTheDocument();
    expect(buyButton()).toBeDisabled();
  });

  it("will not offer a buy while the trading wallet is not open: it says how to open it, and never pays from the main wallet", async () => {
    const chain = fakeChain({ balances: { [TEST_USER.toLowerCase()]: parseEther("50") } });
    const value: SessionValue = { status: "needs-signature", account: undefined, main: TEST_USER, enable: async () => true };
    const view = renderWithWallet(
      <SessionContext.Provider value={value}>
        <BuyPanel chain="sepolia" token={TOKEN} ticker="DEMO" />
      </SessionContext.Provider>,
      [externalConnector()],
      chain.transport,
    );
    await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
    await userEvent.setup().type(budgetInput(), "0.01");
    expect(buyButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open trading wallet" })).toBeInTheDocument();
  });

  it("asks to connect a wallet instead of offering a buy that cannot happen", async () => {
    await setup({}, { connected: false });
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
  });
});
