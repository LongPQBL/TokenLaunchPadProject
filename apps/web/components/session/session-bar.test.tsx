import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { embeddedId, externalConnector, renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { SessionBar } from "./session-bar";

const SESSION = privateKeyToAccount(`0x${"22".repeat(32)}`);
const HASH = `0x${"ab".repeat(32)}` as const;

const session = vi.hoisted(() => ({
  value: { status: "ready", account: undefined } as { status: string; account?: { address: string } },
  enable: vi.fn(),
}));
vi.mock("@/lib/session/use-session", () => ({ useSession: () => ({ ...session.value, enable: session.enable }) }));

const send = vi.hoisted(() => ({ sendTransactionAsync: vi.fn() }));
vi.mock("wagmi", async (importOriginal) => ({ ...(await importOriginal<typeof import("wagmi")>()), useSendTransaction: () => send }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  session.value = { status: "ready", account: SESSION };
  session.enable.mockReset().mockResolvedValue(true);
  send.sendTransactionAsync.mockReset().mockResolvedValue(HASH);
});
afterEach(() => vi.unstubAllEnvs());

async function setup(balances: { main?: bigint; session?: bigint } = {}, extra: Record<string, unknown> = {}) {
  const chain = fakeChain({
    ...extra,
    balances: {
      [TEST_USER.toLowerCase()]: balances.main ?? parseEther("1.5"),
      [SESSION.address.toLowerCase()]: balances.session ?? parseEther("0.25"),
    },
  });
  const view = renderWithWallet(<SessionBar chain="sepolia" />, [externalConnector()], chain.transport);
  await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { chain, user: userEvent.setup(), ...view };
}

const row = (name: string) => screen.getByTestId(name);

describe("SessionBar: balances in dollars", () => {
  it("shows a wallet's balance in dollars, and only dollars, once the chain's price feed answers", async () => {
    await setup({ main: parseEther("1.5") }, { usd: { answer: 3_000n * 10n ** 8n } });
    await waitFor(() => expect(within(row("main-wallet")).getByText("$4,500.00")).toBeInTheDocument());
    expect(within(row("main-wallet")).queryByText(/ETH/)).toBeNull();
  });
});

describe("SessionBar: not open yet", () => {
  it("says the trading wallet is opening, and shows the main wallet it will be funded from", async () => {
    session.value = { status: "restoring", account: undefined };
    await setup();
    expect(await screen.findByText("Opening your trading wallet…")).toBeInTheDocument();
    await waitFor(() => expect(within(row("main-wallet")).getByText("1.5 ETH")).toBeInTheDocument());
    expect(screen.queryByTestId("trading-wallet")).not.toBeInTheDocument();
  });

  it("offers the one signature that opens it, saying what it is, and opens it with a click", async () => {
    session.value = { status: "needs-signature", account: undefined };
    const { user } = await setup();
    expect(screen.getByText(/Sign one message with your main wallet/)).toBeInTheDocument();
    expect(screen.getByText(/Only keep small amounts in it/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open trading wallet" }));
    expect(session.enable).toHaveBeenCalledOnce();
  });

  it("has no switch to turn the trading wallet on or off: it is not optional", async () => {
    await setup();
    expect(screen.queryByRole("button", { name: /Turn on trading wallet|Use main wallet|Turn off/ })).toBeNull();
  });

  it("shows nothing at all with no wallet connected", () => {
    const { container } = renderWithWallet(<SessionBar chain="sepolia" />, undefined, fakeChain().transport);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SessionBar: on", () => {
  beforeEach(() => {
    session.value = { status: "ready", account: SESSION };
  });

  it("always shows BOTH wallets, each with its own address and balance and its own label, never merged into one figure", async () => {
    await setup();
    await waitFor(() => expect(within(row("trading-wallet")).getByText("0.25 ETH")).toBeInTheDocument());
    expect(within(row("main-wallet")).getByText("1.5 ETH")).toBeInTheDocument();
    expect(within(row("main-wallet")).getByText("Main wallet")).toBeInTheDocument();
    expect(within(row("trading-wallet")).getByText("Trading wallet")).toBeInTheDocument();
    expect(within(row("trading-wallet")).getByText(new RegExp(SESSION.address.slice(0, 6), "i"))).toBeInTheDocument();
    expect(within(row("main-wallet")).getByText(new RegExp(TEST_USER.slice(0, 6), "i"))).toBeInTheDocument();
    expect(screen.queryByText("1.75 ETH")).not.toBeInTheDocument(); // no total
  });

  it("marks the trading wallet as the one being spent, and only that one", async () => {
    await setup();
    expect(row("trading-wallet")).toHaveAttribute("data-spending", "true");
    expect(row("main-wallet")).toHaveAttribute("data-spending", "false");
    expect(within(row("trading-wallet")).getByText("Trading from this wallet")).toBeInTheDocument();
  });

  it("offers Withdraw all, from the trading wallet's own row", async () => {
    await setup();
    expect(within(row("trading-wallet")).getByRole("button", { name: "Withdraw all" })).toBeInTheDocument();
    expect(within(row("main-wallet")).queryByRole("button", { name: "Withdraw all" })).not.toBeInTheDocument();
  });
});

describe("SessionBar: top up", () => {
  beforeEach(() => {
    session.value = { status: "ready", account: SESSION };
  });

  async function openTopUp() {
    const view = await setup();
    await view.user.click(screen.getByRole("button", { name: "Top up" }));
    return view;
  }

  it("suggests 0.1 to 0.3 ETH and says why: a key in a browser should not hold a whole balance", async () => {
    await openTopUp();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/should not hold your whole balance/)).toBeInTheDocument();
    for (const amount of ["0.1", "0.2", "0.3"]) expect(within(dialog).getByRole("button", { name: `${amount} ETH` })).toBeInTheDocument();
  });

  it("sends the amount from the main wallet to the trading wallet, and shows the resulting balance", async () => {
    const { user, chain } = await openTopUp();
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "0.2 ETH" }));
    expect(within(dialog).getByLabelText("Amount (ETH)")).toHaveValue("0.2");
    // after the transfer the trading wallet holds 0.45
    send.sendTransactionAsync.mockImplementation(async () => {
      chain.set({ balances: { [TEST_USER.toLowerCase()]: parseEther("1.3"), [SESSION.address.toLowerCase()]: parseEther("0.45") } });
      return HASH;
    });
    await user.click(within(dialog).getByRole("button", { name: "Send from main wallet" }));

    expect(send.sendTransactionAsync).toHaveBeenCalledWith({ to: SESSION.address, value: parseEther("0.2") });
    expect(await screen.findByText("Sent 0.2 ETH. Your trading wallet now has 0.45 ETH.")).toBeInTheDocument();
  });

  it("will not send more than the main wallet holds, and says so", async () => {
    const { user } = await setup({ main: parseEther("0.05") });
    await user.click(screen.getByRole("button", { name: "Top up" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Amount (ETH)"), "0.1");
    expect(within(dialog).getByText("Your main wallet does not have enough ETH for this and network fees.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send from main wallet" })).toBeDisabled();
  });

  it.each(["", "0", "-1", "abc", "1e2"])("will not send an amount of %j, without an error message", async (text) => {
    const { user } = await openTopUp();
    const dialog = screen.getByRole("dialog");
    if (text) await user.type(within(dialog).getByLabelText("Amount (ETH)"), text);
    expect(within(dialog).getByRole("button", { name: "Send from main wallet" })).toBeDisabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays calm when the person declines the transfer", async () => {
    const { UserRejectedRequestError } = await import("viem");
    send.sendTransactionAsync.mockRejectedValue(new UserRejectedRequestError(new Error("no")));
    const { user } = await openTopUp();
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "0.1 ETH" }));
    await user.click(within(dialog).getByRole("button", { name: "Send from main wallet" }));
    await waitFor(() => expect(send.sendTransactionAsync).toHaveBeenCalled());
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send from main wallet" })).toBeEnabled();
  });
});

describe("SessionBar: the trading wallet cannot be used", () => {
  it("says plainly that nothing is lost when the wallet signed differently, and offers no way to make another", async () => {
    session.value = { status: "mismatch", account: undefined };
    await setup();
    expect(screen.getByText("Your wallet signed differently than before")).toBeInTheDocument();
    expect(screen.getByText(/no funds are lost/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open trading wallet|Restore|Turn on/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("trading-wallet")).not.toBeInTheDocument();
  });
});

// Spec 7.3 and 7.4: an embedded wallet IS the trading wallet. One wallet, one address, nothing to turn on or top up.
describe("SessionBar: an embedded wallet", () => {
  /** A mock wallet that calls itself Privy's embedded wallet. */
  const embedded = (id = embeddedId(TEST_USER)) => {
    const base = mock({ accounts: [TEST_USER] });
    return [(cfg: Parameters<typeof base>[0]) => ({ ...base(cfg), id })];
  };

  async function setupEmbedded(id?: string) {
    const chain = fakeChain({ balances: { [TEST_USER.toLowerCase()]: parseEther("1.5") } });
    const view = renderWithWallet(<SessionBar chain="sepolia" />, embedded(id), chain.transport);
    await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
    return view;
  }

  it("shows one wallet, called Your wallet, with its address and balance, marked as the one that pays", async () => {
    await setupEmbedded();
    expect(await screen.findByText("Your wallet")).toBeInTheDocument();
    const rows = screen.getAllByTestId("main-wallet");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-spending", "true");
    expect(await within(rows[0]!).findByText("1.5 ETH")).toBeInTheDocument();
    expect(screen.queryByTestId("trading-wallet")).toBeNull();
  });

  it("tells a new embedded user with no ETH how to add some, right where their wallet is shown", async () => {
    const chain = fakeChain({ balances: { [TEST_USER.toLowerCase()]: 0n } });
    const base = mock({ accounts: [TEST_USER] });
    const connectors = [(cfg: Parameters<typeof base>[0]) => ({ ...base(cfg), id: embeddedId(TEST_USER) })];
    const view = renderWithWallet(<SessionBar chain="sepolia" />, connectors, chain.transport);
    await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
    expect(await screen.findByText(/holds no ETH/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("never offers a trading wallet, a top-up or a withdrawal, and never asks for the signature that would make one", async () => {
    for (const status of ["off", "needs-signature", "mismatch", "restoring"]) {
      session.value = { status, account: undefined };
      const view = await setupEmbedded();
      await screen.findByText("Your wallet");
      for (const name of [/turn on/i, /top up/i, /withdraw/i, /restore/i, /turn off/i]) expect(screen.queryByRole("button", { name }), `${status} ${name}`).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      view.unmount();
    }
    expect(session.enable).not.toHaveBeenCalled();
  });

  it("does not show a trading wallet even if a session somehow exists for it", async () => {
    session.value = { status: "ready", account: SESSION };
    await setupEmbedded();
    await screen.findByText("Your wallet");
    expect(screen.queryByTestId("trading-wallet")).toBeNull();
  });

  // Review Focus 2: only Privy's own embedded wallet gets this. An external wallet, even one that logged in through Privy, keeps its trading wallet.
  it("treats a wallet with a look-alike id as an ordinary one, whose trading wallet is its own and is shown as such", async () => {
    await setupEmbedded("io.privy.wallet.evil");
    expect(await screen.findByTestId("trading-wallet")).toBeInTheDocument();
    expect(screen.getByTestId("main-wallet")).toHaveTextContent("Main wallet");
    expect(screen.queryByText("Your wallet")).toBeNull();
  });
});

