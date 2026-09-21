import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, freshCurve } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { TradePanel } from "./trade-panel";

const TOKEN = "0x00000000000000000000000000000000000000b2" as const;

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
});
afterEach(() => vi.unstubAllEnvs());

describe("TradePanel", () => {
  it("opens on Buy and switches to Sell", async () => {
    const chain = fakeChain();
    renderWithWallet(<TradePanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Amount to spend (ETH)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Amount to sell (DEMO)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Sell" }));
    expect(screen.getByLabelText("Amount to sell (DEMO)")).toBeInTheDocument();
  });

  it("is replaced as a whole by GRADUATING… when the curve is complete", async () => {
    const chain = fakeChain({ curve: freshCurve({ complete: true }) });
    renderWithWallet(<TradePanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
    // Both the gate and the buy panel notice; what matters is where it settles: one message, no tabs.
    await waitFor(() => {
      expect(screen.getAllByText("GRADUATING…")).toHaveLength(1);
      expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    });
  });

  // The last buy fills the curve, so the panel is replaced by GRADUATING… in the same moment the purchase confirms.
  // The person must still be told what they got: a confirmation that vanishes with the panel is no confirmation.
  it("keeps the confirmation of a purchase visible after that purchase fills the curve", async () => {
    const chain = fakeChain();
    trade.buyWithEth.mockImplementation(async () => {
      chain.set({ curve: freshCurve({ complete: true }) });
      return { hash: `0x${"ab".repeat(32)}`, tokenAmount: 800_000_000n * 10n ** 18n, quoteAmount: 4n * 10n ** 16n, fee: 4n * 10n ** 14n, launchTax: 0n };
    });
    const view = renderWithWallet(<TradePanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
    await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Amount to spend (ETH)"), "0.05");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Buy" }));

    await waitFor(() => expect(screen.getByText("GRADUATING…")).toBeInTheDocument());
    expect(screen.getByText(/You bought 800M DEMO for 0\.0404 ETH/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toBeInTheDocument();
  });
});
