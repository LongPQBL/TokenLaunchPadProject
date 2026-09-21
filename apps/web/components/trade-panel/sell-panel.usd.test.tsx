import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { centsToText, formatCompactTokens, formatQuote, formatUsd, previewSellLocal, quoteToUsdCents, usdToQuote } from "@vezta/shared";
import { formatUnits } from "viem";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, freshCurve } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { SellPanel } from "./sell-panel";

const TOKEN = "0x00000000000000000000000000000000000000b2" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const E18 = 10n ** 18n;
const RATE = { answer: 3_000n * 10n ** 8n, decimals: 8 };

const trade = vi.hoisted(() => ({
  capabilities: { kind: "self-custody", address: undefined, chainId: undefined, canBatch: false, isZeroPrompt: false },
  buyWithEth: vi.fn(),
  sell: vi.fn(),
  approveIfNeeded: vi.fn(),
  createToken: vi.fn(),
}));
vi.mock("@/lib/wallet/use-trade", () => ({ useTrade: () => trade }));

// (a small curve: the whole 5,000,000-token balance below is worth about $0.28, so the amounts typed here are cents)
const SOLD = 10_000_000n * E18;
const curve = freshCurve({
  virtualTokenReserves: (10n ** 27n * 16n) / 15n - SOLD,
  virtualQuoteReserves: 20_000_000_000_000_000n,
  realTokenReserves: 10n ** 27n - SOLD,
});
/** What a number of tokens is worth at the price the curve is at: the same rule the panel uses to turn dollars into tokens. */
const worth = (tokens: bigint) => quoteToUsdCents((tokens * curve.virtualQuoteReserves) / curve.virtualTokenReserves, RATE);
const tokensFor = (cents: bigint) => (usdToQuote(cents, RATE) * curve.virtualTokenReserves) / curve.virtualQuoteReserves;
const okResult = { hash: HASH, tokenAmount: 1_000n * E18, quoteAmount: 4n * 10n ** 15n, fee: 4n * 10n ** 13n, launchTax: 0n };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  localStorage.clear();
  trade.capabilities.canBatch = false;
  for (const fn of [trade.sell, trade.approveIfNeeded, trade.buyWithEth]) fn.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const BALANCE = 5_000_000n * E18;
async function setup(initial = {}, withRate = true) {
  const chain = fakeChain({ curve, tokenBalance: BALANCE, allowance: 10n ** 30n, ...(withRate ? { usd: { answer: RATE.answer } } : {}), ...initial });
  const view = renderWithWallet(<SellPanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
  await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { chain, ...view, user: userEvent.setup() };
}
const dollars = () => screen.findByRole("textbox", { name: "Amount to sell (USD)" });
const sellButton = () => screen.getByRole("button", { name: "Sell" });

describe("SellPanel in dollars", () => {
  it("takes dollars by default once the price is known", async () => {
    await setup();
    expect(await dollars()).toBeInTheDocument();
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Amount to sell (DEMO)" })).toBeNull();
  });

  it("says how many tokens that many dollars is, at the price the curve is at", async () => {
    const { user } = await setup();
    await user.type(await dollars(), "0.1");
    expect(screen.getByTestId("equivalent")).toHaveTextContent(`≈ ${formatCompactTokens(tokensFor(10n))} DEMO`);
  });

  it("says what selling them pays, in ETH and in dollars", async () => {
    const { user } = await setup();
    await user.type(await dollars(), "0.1");
    const payout = previewSellLocal(curve, 100n, tokensFor(10n)).payout;
    await waitFor(() =>
      expect(screen.getByTestId("receive")).toHaveTextContent(`You receive ≈ ${formatQuote(payout, 18, 6)} ETH ≈ ${formatUsd(quoteToUsdCents(payout, RATE))}`),
    );
  });

  it("sells the tokens those dollars are worth", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup();
    await user.type(await dollars(), "0.1");
    await waitFor(() => expect(sellButton()).toBeEnabled());
    await user.click(sellButton());
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, amount: tokensFor(10n) }));
  });

  it("shows the balance in tokens and in dollars", async () => {
    await setup();
    await dollars();
    await waitFor(() => expect(screen.getByTestId("balance")).toHaveTextContent(`Balance ${formatCompactTokens(BALANCE)} DEMO ≈ ${formatUsd(worth(BALANCE))}`));
  });

  it("Max fills in what the whole balance is worth, and sells the balance to the last unit, not that figure turned back into tokens", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup();
    const box = await dollars();
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(box).toHaveValue(centsToText(worth(BALANCE)));
    await waitFor(() => expect(sellButton()).toBeEnabled());
    await user.click(sellButton());
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ amount: BALANCE }));
  });

  it("stops being 'all of it' the moment the number is changed by hand", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup();
    const box = await dollars();
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Max" }));
    await user.clear(box);
    await user.type(box, "0.1");
    await waitFor(() => expect(sellButton()).toBeEnabled());
    await user.click(sellButton());
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ amount: tokensFor(10n) }));
  });

  it("says there are not enough tokens, and will not sell, when the dollars are worth more than are held", async () => {
    const { user } = await setup();
    await user.type(await dollars(), centsToText(worth(BALANCE) + 5_000n)); // $50 more than the whole balance is worth
    expect(await screen.findByText("Insufficient token balance")).toBeInTheDocument();
    expect(sellButton()).toBeDisabled();
  });

  it("does not quote what is not money: a third decimal, text, or a minus", async () => {
    const { user } = await setup();
    const box = await dollars();
    for (const bad of ["1.234", "abc", "-5"]) {
      await user.clear(box);
      await user.type(box, bad);
      expect(screen.queryByTestId("receive"), bad).toBeNull();
      expect(sellButton(), bad).toBeDisabled();
    }
  });

  it("switches to tokens, keeping the same amount, and back", async () => {
    const { user } = await setup();
    await user.type(await dollars(), "0.1");
    await user.click(screen.getByRole("button", { name: "Enter in DEMO" }));
    const tokens = screen.getByRole("textbox", { name: "Amount to sell (DEMO)" });
    expect(tokens).toHaveValue(formatUnits(tokensFor(10n), 18));
    expect(screen.getByTestId("equivalent")).toHaveTextContent(/^≈ \$0\.09$|^≈ \$0\.10$/);
    await user.click(screen.getByRole("button", { name: "Enter in USD" }));
    expect(screen.getByRole("textbox", { name: "Amount to sell (USD)" })).toBeInTheDocument();
  });

  it("with the switch on tokens, Max still sells the whole balance", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup();
    await dollars();
    await user.click(screen.getByRole("button", { name: "Enter in DEMO" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("textbox", { name: "Amount to sell (DEMO)" })).toHaveValue(formatUnits(BALANCE, 18));
    await waitFor(() => expect(sellButton()).toBeEnabled());
    await user.click(sellButton());
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ amount: BALANCE }));
  });
});

describe("SellPanel when there is no price", () => {
  it("takes tokens, offers no switch, and shows no dollar anywhere", async () => {
    const { user } = await setup({}, false);
    await user.type(await screen.findByRole("textbox", { name: "Amount to sell (DEMO)" }), "1000000");
    expect(screen.queryByRole("button", { name: /Enter in/ })).toBeNull();
    expect(screen.queryByText("$")).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });
});

describe("SellPanel colours", () => {
  it("the Sell button is red", async () => {
    await setup();
    await dollars();
    expect(sellButton().className).toContain("bg-sell");
    expect(sellButton().className).not.toContain("bg-primary");
  });
});
