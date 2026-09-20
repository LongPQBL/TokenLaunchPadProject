import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatCompactTokens, formatQuote, minPayoutWithSlippage, previewSellLocal } from "@vezta/shared";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, freshCurve } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { SellPanel } from "./sell-panel";

const TOKEN = "0x00000000000000000000000000000000000000b2" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const E18 = 10n ** 18n;

const trade = vi.hoisted(() => ({
  capabilities: { kind: "self-custody", address: undefined, chainId: undefined, canBatch: false, isZeroPrompt: false },
  buyWithEth: vi.fn(),
  sell: vi.fn(),
  approveIfNeeded: vi.fn(),
  createToken: vi.fn(),
}));
vi.mock("@/lib/wallet/use-trade", () => ({ useTrade: () => trade }));

// A curve with 10M tokens already sold, so there is something to sell back into.
const SOLD = 10_000_000n * E18;
const curve = freshCurve({
  virtualTokenReserves: (10n ** 27n * 16n) / 15n - SOLD,
  virtualQuoteReserves: 20_000_000_000_000_000n,
  realTokenReserves: 10n ** 27n - SOLD,
});
const sale = (tokens: bigint) => previewSellLocal(curve, 100n, tokens * E18);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  localStorage.clear();
  trade.capabilities.canBatch = false;
  for (const fn of [trade.sell, trade.approveIfNeeded, trade.buyWithEth]) fn.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

async function setup(initial = {}) {
  const chain = fakeChain({ curve, tokenBalance: 5_000_000n * E18, allowance: 0n, ...initial });
  const view = renderWithWallet(<SellPanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
  await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { chain, ...view, user: userEvent.setup() };
}

const amountInput = () => screen.getByLabelText("Amount to sell (DEMO)");
const okResult = { hash: HASH, tokenAmount: 1_000n * E18, quoteAmount: 4n * 10n ** 15n, fee: 4n * 10n ** 13n, launchTax: 0n };

describe("SellPanel: the quote", () => {
  it("shows what a sale pays, and the least it will accept after slippage", async () => {
    const { user } = await setup({ tokenBalance: 20_000_000n * E18 });
    await user.type(amountInput(), "10000000");
    const q = sale(10_000_000n);
    const table = await screen.findByTestId("cost-breakdown");
    await waitFor(() => expect(within(table).getByText(formatQuote(q.payout, 18, 6))).toBeInTheDocument());
    expect(within(table).getByText(formatQuote(minPayoutWithSlippage(q.payout, 100n), 18, 6))).toBeInTheDocument();
  });
});

describe("SellPanel: allowance", () => {
  it("with too little allowance shows 'Step 1 of 2: approve selling', and approves first, then sells", async () => {
    const order: string[] = [];
    trade.approveIfNeeded.mockImplementation(async () => void order.push("approve"));
    trade.sell.mockImplementation(async () => (order.push("sell"), okResult));
    const { user } = await setup({ allowance: 0n });
    await user.type(amountInput(), "1000000");

    const button = await screen.findByRole("button", { name: "Step 1 of 2: approve selling" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(order).toEqual(["approve", "sell"]));
    expect(trade.approveIfNeeded).toHaveBeenCalledWith({ token: TOKEN, amount: 1_000_000n * E18, exact: false });
  });

  it("with enough allowance skips the approval entirely", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup({ allowance: 10n ** 30n });
    await user.type(amountInput(), "1000000");
    expect(screen.queryByRole("button", { name: /Step 1 of 2/ })).not.toBeInTheDocument();
    const button = await screen.findByRole("button", { name: "Sell" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(trade.sell).toHaveBeenCalled());
    expect(trade.approveIfNeeded).not.toHaveBeenCalled();
  });

  it("defaults to a one-time maximum approval, says so plainly, and offers to approve only this sale", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup({ allowance: 0n });
    await user.type(amountInput(), "1000000");
    expect(await screen.findByText(/Approve once, and every future sale/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Approve only this sale" }));
    const button = screen.getByRole("button", { name: "Step 1 of 2: approve selling" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(trade.approveIfNeeded).toHaveBeenCalledWith({ token: TOKEN, amount: 1_000_000n * E18, exact: true }));
  });

  it("with a wallet that batches, drops the step label and leaves the approval to the seam", async () => {
    trade.capabilities.canBatch = true;
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup({ allowance: 0n });
    await user.type(amountInput(), "1000000");
    expect(screen.queryByText(/Step 1 of 2/)).not.toBeInTheDocument();
    const button = await screen.findByRole("button", { name: "Sell" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(trade.sell).toHaveBeenCalledOnce());
    expect(trade.approveIfNeeded).not.toHaveBeenCalled();
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ exactApproval: false }));
  });

  it("does not sell after the person declines the approval", async () => {
    const { TradeError } = await import("@/lib/wallet/types");
    trade.approveIfNeeded.mockRejectedValue(new TradeError("user_rejected", "declined"));
    const { user } = await setup({ allowance: 0n });
    await user.type(amountInput(), "1000000");
    const button = await screen.findByRole("button", { name: "Step 1 of 2: approve selling" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(trade.approveIfNeeded).toHaveBeenCalled());
    expect(trade.sell).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SellPanel: selling", () => {
  it("sends minQuoteOutput = payout x (1 - slippage), which is never zero", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup({ allowance: 10n ** 30n });
    await user.type(amountInput(), "1000000");
    const button = await screen.findByRole("button", { name: "Sell" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    const min = minPayoutWithSlippage(sale(1_000_000n).payout, 100n);
    expect(min).toBeGreaterThan(0n);
    expect(trade.sell).toHaveBeenCalledWith({ token: TOKEN, amount: 1_000_000n * E18, minQuoteOutput: min, exactApproval: false });
  });

  it("disables the sale of an amount too small to pay anything, rather than send a bound of zero", async () => {
    const { user } = await setup({ allowance: 10n ** 30n });
    await user.type(amountInput(), "0.000000000000000001"); // one wei of a token
    expect(await screen.findByRole("button", { name: "Sell" })).toBeDisabled();
  });

  it("refuses to sell more than the balance, client-side, and says so", async () => {
    const { user } = await setup({ allowance: 10n ** 30n, tokenBalance: 100n * E18 });
    await user.type(amountInput(), "101");
    expect(await screen.findByText("Insufficient token balance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();
  });

  it("Max fills in the whole balance", async () => {
    const { user } = await setup({ allowance: 10n ** 30n, tokenBalance: 250n * E18 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(amountInput()).toHaveValue("250");
  });

  it("reports what the Trade event says was sold and received", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup({ allowance: 10n ** 30n });
    await user.type(amountInput(), "1000000");
    const button = await screen.findByRole("button", { name: "Sell" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    // 4e15 wei of curve price less the 4e13 fee: 0.00396 ETH
    expect(await screen.findByText(/You sold/)).toHaveTextContent(`You sold ${formatCompactTokens(1_000n * E18)} DEMO and received 0.00396 ETH.`);
  });

  it("says nothing for an empty or zero amount", async () => {
    await setup();
    expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Insufficient token balance")).not.toBeInTheDocument();
  });
});
