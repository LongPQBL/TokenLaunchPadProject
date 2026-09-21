import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatCompactTokens, formatQuote, formatUsd, previewSellLocal, quoteToUsdCents } from "@vezta/shared";
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

// (a small curve: the whole 5,000,000-token balance below is worth about $0.28)
const SOLD = 10_000_000n * E18;
const curve = freshCurve({
  virtualTokenReserves: (10n ** 27n * 16n) / 15n - SOLD,
  virtualQuoteReserves: 20_000_000_000_000_000n,
  realTokenReserves: 10n ** 27n - SOLD,
});
/** What a number of tokens is worth at the price the curve is at, in dollar cents. */
const worth = (tokens: bigint) => quoteToUsdCents((tokens * curve.virtualQuoteReserves) / curve.virtualTokenReserves, RATE);
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
const tokens = () => screen.findByRole("textbox", { name: "Amount to sell (DEMO)" });
const sellButton = () => screen.getByRole("button", { name: "Sell" });

// What is typed to sell is a number of TOKENS, whether or not there is a dollar price: the dollars are only said beside it.
describe("SellPanel: an amount of tokens, with the dollars beside it", () => {
  it("takes tokens even when the price is known: no dollar box, no switch to one", async () => {
    await setup();
    expect(await tokens()).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Amount to sell (USD)" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enter in/ })).toBeNull();
    expect(screen.queryByText("$")).toBeNull(); // no dollar sign in front of the box
  });

  it("says what that many tokens are worth in dollars, at the price the curve is at", async () => {
    const { user } = await setup();
    await user.type(await tokens(), "1000000");
    expect(screen.getByTestId("equivalent")).toHaveTextContent(`≈ ${formatUsd(worth(1_000_000n * E18))}`);
  });

  it("says what selling them pays in the breakdown only, with no separate \"You receive\" line above it", async () => {
    const { user } = await setup();
    await user.type(await tokens(), "1000000");
    const payout = previewSellLocal(curve, 100n, 1_000_000n * E18).payout;
    await waitFor(() => expect(screen.getByTestId("cost-breakdown")).toHaveTextContent(`You get (est.)${formatQuote(payout, 18, 6)}`));
    expect(screen.queryByTestId("receive")).toBeNull();
    expect(screen.queryByText(/You receive/)).toBeNull();
  });

  it("types into a box as large as the one on the Buy side", async () => {
    await setup();
    const box = await tokens();
    expect(box.parentElement).toHaveClass("text-5xl");
    expect(box.parentElement).not.toHaveClass("text-3xl");
  });

  it("sells exactly the tokens typed, decimals included", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup();
    await user.type(await tokens(), "1234.5");
    await waitFor(() => expect(sellButton()).toBeEnabled());
    await user.click(sellButton());
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, amount: 12_345n * E18 / 10n }));
  });

  it("shows the balance in tokens and in dollars", async () => {
    await setup();
    await tokens();
    await waitFor(() => expect(screen.getByTestId("balance")).toHaveTextContent(`Balance ${formatCompactTokens(BALANCE)} DEMO ≈ ${formatUsd(worth(BALANCE))}`));
  });

  it("Max fills in the whole balance, in tokens, and sells it to the last unit", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup({ tokenBalance: 5_000_000n * E18 + 123n }); // a balance with dust: no rounding may leave any behind
    const box = await tokens();
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(box).toHaveValue(formatUnits(5_000_000n * E18 + 123n, 18));
    await waitFor(() => expect(sellButton()).toBeEnabled());
    await user.click(sellButton());
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ amount: 5_000_000n * E18 + 123n }));
  });

  it("sells what is typed after Max, not the balance", async () => {
    trade.sell.mockResolvedValue(okResult);
    const { user } = await setup();
    const box = await tokens();
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Max" }));
    await user.clear(box);
    await user.type(box, "1000");
    await waitFor(() => expect(sellButton()).toBeEnabled());
    await user.click(sellButton());
    expect(trade.sell).toHaveBeenCalledWith(expect.objectContaining({ amount: 1_000n * E18 }));
  });

  it("says there are not enough tokens, and will not sell, when more are typed than are held", async () => {
    const { user } = await setup();
    await user.type(await tokens(), "5000001");
    expect(await screen.findByText("Insufficient token balance")).toBeInTheDocument();
    expect(sellButton()).toBeDisabled();
  });

  it("does not quote what is not a number of tokens: text, a minus, two points", async () => {
    const { user } = await setup();
    const box = await tokens();
    for (const bad of ["abc", "-5", "1.2.3"]) {
      await user.clear(box);
      await user.type(box, bad);
      expect(screen.queryByTestId("cost-breakdown"), bad).toBeNull();
      expect(sellButton(), bad).toBeDisabled();
    }
  });
});

describe("SellPanel when there is no price", () => {
  it("takes tokens the same way, and shows no dollar anywhere", async () => {
    const { user } = await setup({}, false);
    await user.type(await tokens(), "1000000");
    expect(screen.queryByRole("button", { name: /Enter in/ })).toBeNull();
    expect(screen.queryByText("$")).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });
});

describe("SellPanel colours", () => {
  it("the Sell button is red", async () => {
    await setup();
    await tokens();
    expect(sellButton().className).toContain("bg-sell");
    expect(sellButton().className).not.toContain("bg-primary");
  });
});
