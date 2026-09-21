import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { SessionContext, type SessionValue } from "@/lib/session/use-session";
import { embeddedConnector, externalConnector, renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { WalletMenu } from "./wallet-menu";

const TRADING = privateKeyToAccount(generatePrivateKey());
const ready: SessionValue = { status: "ready", account: TRADING, main: TEST_USER, enable: async () => true };

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));

async function show(o: { session?: SessionValue; embedded?: boolean; address?: string } = {}) {
  const chain = fakeChain({ balances: { [TEST_USER.toLowerCase()]: parseEther("1.5"), [TRADING.address.toLowerCase()]: parseEther("0.25") } });
  const session = o.session ?? ready;
  const view = renderWithWallet(
    <SessionContext.Provider value={session}>
      <WalletMenu chain="sepolia" address={o.address ?? (o.embedded ? TEST_USER : TRADING.address)} />
    </SessionContext.Provider>,
    [o.embedded ? embeddedConnector(TEST_USER) : externalConnector()],
    chain.transport,
  );
  await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { user: userEvent.setup(), ...view };
}
const chip = () => screen.getByRole("button", { name: "Wallet" });

describe("WalletMenu", () => {
  it("shows the short address of the trading wallet on its button, and opens to the whole address with a way to copy it", async () => {
    const { user } = await show();
    expect(await within(chip()).findByText(new RegExp(`^${TRADING.address.slice(0, 6)}`, "i"))).toBeInTheDocument();
    await user.click(chip());
    const menu = await screen.findByText("Trading wallet");
    expect(menu).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toHaveTextContent(TRADING.address);
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${TRADING.address}`);
  });

  it("names the main wallet behind an external wallet's trading wallet, and offers Withdraw all", async () => {
    const { user } = await show();
    await user.click(chip());
    expect(await screen.findByText("Main wallet")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${TEST_USER.slice(0, 6)}`, "i"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw all" })).toBeInTheDocument();
  });

  it("opens the withdraw dialog from the menu, and the dialog stays open (the menu does not take it down with it)", async () => {
    const { user } = await show();
    await user.click(chip());
    await user.click(await screen.findByRole("button", { name: "Withdraw all" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Withdraw everything" })).toBeInTheDocument();
    await user.hover(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no Withdraw all and no main wallet for a wallet that signs by itself: there is only one wallet", async () => {
    const { user } = await show({ embedded: true, session: { status: "none", account: undefined, main: undefined, enable: async () => false } });
    await user.click(chip());
    expect(await screen.findByText("Your wallet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw all" })).toBeNull();
    expect(screen.queryByText("Main wallet")).toBeNull();
  });

  it("says how to open the trading wallet, instead of its details, while it is not open", async () => {
    const { user } = await show({ session: { status: "needs-signature", account: undefined, main: TEST_USER, enable: async () => true }, address: TEST_USER });
    await user.click(chip());
    expect(await screen.findByRole("button", { name: "Open trading wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  });
});
