import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { SessionContext, type SessionValue } from "@/lib/session/use-session";
import { embeddedConnector, externalConnector, renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { DepositButton } from "./deposit-button";

const send = vi.hoisted(() => ({ sendTransactionAsync: vi.fn() }));
vi.mock("wagmi", async (importOriginal) => ({ ...(await importOriginal<typeof import("wagmi")>()), useSendTransaction: () => send }));

const HASH = `0x${"ab".repeat(32)}` as const;
const TRADING = privateKeyToAccount(generatePrivateKey());
const ready: SessionValue = { status: "ready", account: TRADING, main: TEST_USER, enable: async () => true };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  send.sendTransactionAsync.mockReset().mockResolvedValue(HASH);
});
afterEach(() => vi.unstubAllEnvs());

async function show(o: { session?: SessionValue; embedded?: boolean; connected?: boolean; balances?: Record<string, bigint> } = {}) {
  const chain = fakeChain({ balances: o.balances ?? { [TEST_USER.toLowerCase()]: parseEther("1.5") } });
  const view = renderWithWallet(
    <SessionContext.Provider value={o.session ?? ready}>
      <DepositButton chain="sepolia" />
    </SessionContext.Provider>,
    [o.embedded ? embeddedConnector(TEST_USER) : externalConnector()],
    chain.transport,
  );
  if (o.connected ?? true) await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { chain, user: userEvent.setup(), ...view };
}
const deposit = () => screen.getByRole("button", { name: "Deposit" });

describe("DepositButton: an external wallet", () => {
  it("is offered once the trading wallet is open, and moves ETH from the main wallet into it", async () => {
    const { user, chain } = await show();
    await user.click(deposit());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/should not hold your whole balance/)).toBeInTheDocument();
    for (const amount of ["0.1", "0.2", "0.3"]) expect(within(dialog).getByRole("button", { name: `${amount} ETH` })).toBeInTheDocument();

    chain.set({ balances: { [TRADING.address.toLowerCase()]: parseEther("0.2") } });
    await user.click(within(dialog).getByRole("button", { name: "0.2 ETH" }));
    await user.click(within(dialog).getByRole("button", { name: "Send from main wallet" }));
    await waitFor(() => expect(send.sendTransactionAsync).toHaveBeenCalledOnce());
    // to the TRADING wallet, from the main wallet, on the app's chain
    expect(send.sendTransactionAsync).toHaveBeenCalledWith({ to: TRADING.address, value: parseEther("0.2"), chainId: sepolia.id });
    expect(await within(dialog).findByText(/^Sent 0\.2 ETH\. Your trading wallet now has 0\.2 ETH\.$/)).toBeInTheDocument();
  });

  it("will not send more than the main wallet holds, and says so", async () => {
    const { user } = await show({ balances: { [TEST_USER.toLowerCase()]: parseEther("0.05") } });
    await user.click(deposit());
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Amount (ETH)"), "0.1");
    expect(within(dialog).getByText("Your main wallet does not have enough ETH for this and network fees.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send from main wallet" })).toBeDisabled();
  });

  it.each(["", "0", "-1", "abc", "1e2"])("will not send an amount of %j, without an error message", async (text) => {
    const { user } = await show();
    await user.click(deposit());
    const dialog = screen.getByRole("dialog");
    if (text) await user.type(within(dialog).getByLabelText("Amount (ETH)"), text);
    expect(within(dialog).getByRole("button", { name: "Send from main wallet" })).toBeDisabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays calm when the person declines the transfer", async () => {
    const { UserRejectedRequestError } = await import("viem");
    send.sendTransactionAsync.mockRejectedValue(new UserRejectedRequestError(new Error("no")));
    const { user } = await show();
    await user.click(deposit());
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "0.1 ETH" }));
    await user.click(within(dialog).getByRole("button", { name: "Send from main wallet" }));
    await waitFor(() => expect(send.sendTransactionAsync).toHaveBeenCalled());
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send from main wallet" })).toBeEnabled();
  });

  it("is not offered while the trading wallet is not open, and not with no wallet connected: there is nowhere to deposit to", async () => {
    const closed = await show({ session: { status: "needs-signature", account: undefined, main: TEST_USER, enable: async () => true } });
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.queryByRole("button", { name: "Deposit" })).toBeNull();
    closed.unmount();
    localStorage.clear();
    await show({ connected: false });
    expect(screen.queryByRole("button", { name: "Deposit" })).toBeNull();
  });
});

describe("DepositButton: a wallet that signs by itself", () => {
  it("shows its address to send ETH to, with a way to copy it, since there is no main wallet to deposit from", async () => {
    const { user } = await show({ embedded: true, session: { status: "none", account: undefined, main: undefined, enable: async () => false } });
    await user.click(deposit());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add ETH to your wallet")).toBeInTheDocument();
    expect(within(dialog).getByText(new RegExp(`^${TEST_USER}$`, "i"))).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Send from main wallet" })).toBeNull();
  });
});
