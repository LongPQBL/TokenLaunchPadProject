import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { connect } from "wagmi/actions";
import { mainnet, sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { ChainGuard } from "./chain-guard";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

const child = <button>Buy</button>;

describe("ChainGuard", () => {
  it("shows its children when no wallet is connected: the panel has its own connect prompt", () => {
    renderWithWallet(<ChainGuard chainName="Sepolia">{child}</ChainGuard>);
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
  });

  it("shows its children on the right chain", async () => {
    const { config } = renderWithWallet(<ChainGuard chainName="Sepolia">{child}</ChainGuard>);
    await act(() => connect(config, { connector: config.connectors[0]!, chainId: sepolia.id }));
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
  });

  it("replaces its children with a calm way to switch when the wallet is on another chain", async () => {
    const user = userEvent.setup();
    const { config } = renderWithWallet(<ChainGuard chainName="Sepolia">{child}</ChainGuard>);
    await act(() => connect(config, { connector: config.connectors[0]!, chainId: mainnet.id }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument());
    expect(screen.getByText(/another network/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to Sepolia" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument());
  });
});
