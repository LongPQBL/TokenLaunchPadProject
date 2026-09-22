import { act, screen, within } from "@testing-library/react";
import { parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { SessionContext, type SessionValue } from "@/lib/session/use-session";
import { externalConnector, renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { SiteHeader } from "./site-header";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) })); // the search box's suggestions need one

const TRADING = privateKeyToAccount(generatePrivateKey());
const ready: SessionValue = { status: "ready", account: TRADING, main: TEST_USER, enable: async () => true };

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));

async function show(connected: boolean, session: SessionValue = ready) {
  const chain = fakeChain({ balances: { [TEST_USER.toLowerCase()]: parseEther("1"), [TRADING.address.toLowerCase()]: parseEther("0.2") } });
  const view = renderWithWallet(
    <SessionContext.Provider value={session}>
      <SiteHeader chain="sepolia" sort="new" q="" isTestnet />
    </SessionContext.Provider>,
    [externalConnector()],
    chain.transport,
  );
  if (connected) await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return view;
}

describe("SiteHeader: the wallet", () => {
  it("puts Deposit right after the testnet badge, and the wallet menu after that, once the trading wallet is open", async () => {
    await show(true);
    const header = screen.getByRole("banner");
    const deposit = await within(header).findByRole("button", { name: "Deposit" });
    const badge = within(header).getByText("SEPOLIA TESTNET");
    const wallet = within(header).getByRole("button", { name: "Wallet" });
    expect(badge.compareDocumentPosition(deposit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(deposit.compareDocumentPosition(wallet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("shows neither Deposit nor a wallet menu with no wallet connected: only how to connect", async () => {
    await show(false);
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("button", { name: "Deposit" })).toBeNull();
    expect(within(header).queryByRole("button", { name: "Wallet" })).toBeNull();
    expect(within(header).getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });
});
