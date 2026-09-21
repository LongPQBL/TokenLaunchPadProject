import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { describe, expect, it, vi } from "vitest";
import { SessionContext, type SessionValue } from "@/lib/session/use-session";
import { embeddedConnector, externalConnector, testWallet, TEST_USER } from "@/test/wallet";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { TradingWalletNotice } from "./trading-wallet-notice";

const value = (over: Partial<SessionValue>): SessionValue => ({ status: "ready", account: privateKeyToAccount(generatePrivateKey()), main: TEST_USER, enable: async () => true, ...over });

async function show(session: SessionValue, embedded = false) {
  const wallet = testWallet([embedded ? embeddedConnector(TEST_USER) : externalConnector()]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <wallet.wrapper>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </wallet.wrapper>
  );
  render(<TradingWalletNotice />, { wrapper });
  await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
}

describe("TradingWalletNotice", () => {
  it("says nothing when the trading wallet is open", async () => {
    await show(value({}));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says nothing for a wallet that signs by itself: it is the trading wallet", async () => {
    await show(value({ status: "none", account: undefined }), true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing before a wallet is connected: the panel has its own connect prompt", () => {
    const wallet = testWallet();
    render(<TradingWalletNotice />, { wrapper: wallet.wrapper });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says it is opening while the stored wallet is being found", async () => {
    await show(value({ status: "restoring", account: undefined }));
    expect(screen.getByRole("status")).toHaveTextContent("Opening your trading wallet…");
  });

  it("offers to open it, saying what the one signature is, when a signature is needed", async () => {
    const enable = vi.fn(async () => true);
    await show(value({ status: "needs-signature", account: undefined, enable }));
    expect(screen.getByRole("status")).toHaveTextContent(/Sign one message with your main wallet/);
    await userEvent.click(screen.getByRole("button", { name: "Open trading wallet" }));
    expect(enable).toHaveBeenCalledOnce();
  });

  it("warns, and offers no way to make another wallet, when the main wallet signed differently", async () => {
    await show(value({ status: "mismatch", account: undefined }));
    expect(screen.getByRole("alert")).toHaveTextContent("Your wallet signed differently than before");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
