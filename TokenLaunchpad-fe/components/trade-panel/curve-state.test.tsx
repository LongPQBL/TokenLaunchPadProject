import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { launchpadAbi } from "@vezta/abi";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, freshCurve } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { BuyPanel } from "./buy-panel";
import { CurveGate } from "./curve-state";

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
  trade.buyWithEth.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const revertWith = (errorName: "CurveCompleted" | "SlippageExceeded") => {
  const data = encodeErrorResult({ abi: launchpadAbi, errorName });
  return new BaseError("x", { cause: new ContractFunctionRevertedError({ abi: launchpadAbi, data, functionName: "buyWithEth" }) });
};

describe("CurveGate", () => {
  it("shows the trading panel while the curve is filling", async () => {
    const chain = fakeChain();
    renderWithWallet(
      <CurveGate chain="sepolia" token={TOKEN}>
        <p>the panel</p>
      </CurveGate>,
      undefined,
      chain.transport,
    );
    expect(await screen.findByText("the panel")).toBeInTheDocument();
  });

  it("when the curve is complete but not migrated: removes the panel, says GRADUATING…, and polls every 2 s (here 30 ms)", async () => {
    const chain = fakeChain({ curve: freshCurve({ complete: true }) });
    renderWithWallet(
      <CurveGate chain="sepolia" token={TOKEN} graduatingPollMs={30}>
        <p>the panel</p>
      </CurveGate>,
      undefined,
      chain.transport,
    );
    expect(await screen.findByText("GRADUATING…")).toBeInTheDocument();
    expect(screen.queryByText("the panel")).not.toBeInTheDocument();
    const before = chain.calls.filter((c) => c === "getCurve").length;
    await act(() => new Promise((r) => setTimeout(r, 200)));
    expect(chain.calls.filter((c) => c === "getCurve").length).toBeGreaterThan(before + 2);
  });

  it("when it migrates the panel is replaced by a Trade on Uniswap link, with no reload", async () => {
    const chain = fakeChain({ curve: freshCurve({ complete: true }) });
    renderWithWallet(
      <CurveGate chain="sepolia" token={TOKEN} graduatingPollMs={30}>
        <p>the panel</p>
      </CurveGate>,
      undefined,
      chain.transport,
    );
    await screen.findByText("GRADUATING…");
    chain.set({ curve: freshCurve({ complete: true, migrated: true }) });
    const link = await screen.findByRole("link", { name: "Trade on Uniswap" });
    expect(link).toHaveAttribute("href", `https://app.uniswap.org/swap?chain=sepolia&outputCurrency=${TOKEN}`);
    expect(screen.queryByText("GRADUATING…")).not.toBeInTheDocument();
    expect(screen.queryByText("the panel")).not.toBeInTheDocument();
  });
});

describe("BuyPanel: contract errors as states", () => {
  async function panel(initial = {}) {
    const chain = fakeChain(initial);
    const view = renderWithWallet(<BuyPanel chain="sepolia" token={TOKEN} ticker="DEMO" />, undefined, chain.transport);
    await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
    return { chain, user: userEvent.setup() };
  }

  it("shows GRADUATING… in place of the form when previewBuy reverts CurveCompleted before the curve read has caught up", async () => {
    await panel({ previewBuyRevert: "CurveCompleted" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Amount to spend (ETH)"), "0.01");
    expect(await screen.findByText("GRADUATING…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
  });

  it("turns a CurveCompleted revert that arrives mid-flight into the graduating state, not a red error, and refreshes the curve", async () => {
    trade.buyWithEth.mockRejectedValue(revertWith("CurveCompleted"));
    const { chain, user } = await panel();
    await user.type(screen.getByLabelText("Amount to spend (ETH)"), "0.01");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy" })).toBeEnabled());
    const reads = chain.calls.filter((c) => c === "getCurve").length;
    await user.click(screen.getByRole("button", { name: "Buy" }));

    expect(await screen.findByText("GRADUATING…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(chain.calls.filter((c) => c === "getCurve").length).toBeGreaterThan(reads));
  });

  it("says 'Price changed. Increase slippage or try again.' for a SlippageExceeded revert", async () => {
    trade.buyWithEth.mockRejectedValue(revertWith("SlippageExceeded"));
    const { user } = await panel();
    await user.type(screen.getByLabelText("Amount to spend (ETH)"), "0.01");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Price changed. Increase slippage or try again.");
    expect(screen.getByRole("button", { name: "Buy" })).toBeEnabled(); // and the form is still there to try again
  });
});
