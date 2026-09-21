import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { centsToText, formatCompactTokens, formatQuote, formatUsd, quoteToUsdCents, usdToQuote } from "@vezta/shared";
import { parseEther } from "viem";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBuyQuote } from "@/lib/chain/buy-quote";
import { fakeChain, freshCurve } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { BuyPanel } from "./buy-panel";

const TOKEN = "0x00000000000000000000000000000000000000b2" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const RATE = { answer: 3_000n * 10n ** 8n, decimals: 8 };

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

async function setup(initial = {}) {
  const chain = fakeChain({ usd: { answer: RATE.answer }, ...initial });
  const view = renderWithWallet(<BuyPanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
  await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { chain, ...view, user: userEvent.setup() };
}
/** The box in dollars: it exists once the price has been read. */
const dollars = () => screen.findByRole("textbox", { name: "Amount to spend (USD)" });
const buyButton = () => screen.getByRole("button", { name: "Buy" });

describe("BuyPanel in dollars", () => {
  it("takes dollars by default once the price is known, with the sign beside the number", async () => {
    await setup();
    expect(await dollars()).toBeInTheDocument();
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Amount to spend (ETH)" })).toBeNull();
  });

  it("says what the dollars come to in ETH, under the box", async () => {
    const { user } = await setup();
    await user.type(await dollars(), "2");
    expect(screen.getByTestId("equivalent")).toHaveTextContent(`≈ ${formatQuote(usdToQuote(200n, RATE), 18, 6)} ETH`);
  });

  it("quotes the tokens that many dollars buy, and says what you receive", async () => {
    const { user } = await setup();
    await user.type(await dollars(), "2");
    const q = computeBuyQuote(freshCurve(), 100n, 0n, usdToQuote(200n, RATE));
    await waitFor(() => expect(screen.getByTestId("receive")).toHaveTextContent(`You receive ≈ ${formatCompactTokens(q.amount)} DEMO`));
  });

  it("buys exactly what the dollars quoted", async () => {
    trade.buyWithEth.mockResolvedValue({ hash: HASH, tokenAmount: 1n, quoteAmount: 1n, fee: 0n, launchTax: 0n });
    const { user } = await setup();
    await user.type(await dollars(), "2");
    const q = computeBuyQuote(freshCurve(), 100n, 0n, usdToQuote(200n, RATE));
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());
    expect(trade.buyWithEth).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, amount: q.amount }));
  });

  it("does not quote what is not money: a third decimal, text, or a minus", async () => {
    const { user } = await setup();
    const box = await dollars();
    for (const bad of ["1.234", "abc", "-5"]) {
      await user.clear(box);
      await user.type(box, bad);
      expect(screen.queryByTestId("receive"), bad).toBeNull();
      expect(buyButton(), bad).toBeDisabled();
    }
  });

  it("shows the balance in dollars, with no ETH on the page", async () => {
    await setup({ ethBalance: parseEther("1") });
    await dollars();
    await waitFor(() => expect(screen.getByTestId("balance")).toHaveTextContent(`Balance ${formatUsd(300_000n)}`));
    expect(screen.getByTestId("balance")).not.toHaveTextContent("ETH");
  });

  it("Max fills in the most that can be spent: what is held, less the network fee (250,000 gas at 1 gwei), less 1% for slippage", async () => {
    const { user } = await setup({ ethBalance: parseEther("1") });
    const box = await dollars();
    await waitFor(() => expect(screen.getByTestId("balance")).toHaveTextContent("$3,000.00"));
    await user.click(screen.getByRole("button", { name: "Max" }));
    const spendable = ((parseEther("1") - 250_000n * 1_000_000_000n) * 10_000n) / 10_100n;
    await waitFor(() => expect(box).toHaveValue(centsToText(quoteToUsdCents(spendable, RATE))));
  });

  it("Max has nothing to fill in for a wallet with no ETH", async () => {
    await setup({ ethBalance: 0n });
    await dollars();
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeDisabled());
  });

  it("switches to ETH, keeping the same amount, and back to dollars again", async () => {
    const { user } = await setup();
    await user.type(await dollars(), "3");
    await user.click(screen.getByRole("button", { name: "Enter in ETH" }));
    const eth = screen.getByRole("textbox", { name: "Amount to spend (ETH)" });
    expect(eth).toHaveValue(formatQuote(usdToQuote(300n, RATE), 18));
    expect(screen.getByTestId("equivalent")).toHaveTextContent("≈ $3.00");
    await user.click(screen.getByRole("button", { name: "Enter in USD" }));
    expect(screen.getByRole("textbox", { name: "Amount to spend (USD)" })).toHaveValue("3");
  });

  it("typing ETH in the ETH box buys exactly that much, as before", async () => {
    trade.buyWithEth.mockResolvedValue({ hash: HASH, tokenAmount: 1n, quoteAmount: 1n, fee: 0n, launchTax: 0n });
    const { user } = await setup();
    await dollars();
    await user.click(screen.getByRole("button", { name: "Enter in ETH" }));
    await user.type(screen.getByRole("textbox", { name: "Amount to spend (ETH)" }), "0.01");
    const q = computeBuyQuote(freshCurve(), 100n, 0n, parseEther("0.01"));
    await waitFor(() => expect(buyButton()).toBeEnabled());
    await user.click(buyButton());
    expect(trade.buyWithEth).toHaveBeenCalledWith(expect.objectContaining({ amount: q.amount }));
  });

  it("keeps the itemised breakdown, with the fee, in ETH", async () => {
    const { user } = await setup();
    await user.type(await dollars(), "2");
    expect(await screen.findByTestId("cost-breakdown")).toBeInTheDocument();
    const q = computeBuyQuote(freshCurve(), 100n, 0n, usdToQuote(200n, RATE));
    await waitFor(() => expect(within(screen.getByTestId("cost-breakdown")).getByText(formatQuote(q.total, 18, 6))).toBeInTheDocument());
  });
});

describe("BuyPanel when there is no price", () => {
  it("takes ETH, offers no switch, and shows no dollar anywhere", async () => {
    const chain = fakeChain(); // the feed does not answer
    const view = renderWithWallet(<BuyPanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
    await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
    const eth = await screen.findByRole("textbox", { name: "Amount to spend (ETH)" });
    await userEvent.setup().type(eth, "0.01");
    expect(screen.queryByRole("button", { name: /Enter in/ })).toBeNull();
    expect(screen.queryByText("$")).toBeNull();
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });
});

describe("BuyPanel colours", () => {
  it("the Buy button is green", async () => {
    await setup();
    await dollars();
    expect(buyButton().className).toContain("bg-buy");
    expect(buyButton().className).not.toContain("bg-primary");
  });
});
