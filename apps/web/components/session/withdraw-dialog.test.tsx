import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { WithdrawDialog } from "./withdraw-dialog";

const SESSION = privateKeyToAccount(`0x${"22".repeat(32)}`);
const T1 = "0x00000000000000000000000000000000000000b1";

const withdraw = vi.hoisted(() => ({ withdrawAll: vi.fn() }));
vi.mock("@/lib/session/withdraw", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/session/withdraw")>()), withdrawAll: withdraw.withdrawAll }));
const holdings = vi.hoisted(() => ({ listCandidateTokens: vi.fn() }));
vi.mock("@/lib/session/holdings", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/session/holdings")>()), listCandidateTokens: holdings.listCandidateTokens }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  withdraw.withdrawAll.mockReset().mockResolvedValue({ tokens: 2, ethSent: 3n * 10n ** 17n, failed: [] });
  holdings.listCandidateTokens.mockReset().mockResolvedValue([T1]);
});
afterEach(() => vi.unstubAllEnvs());

async function open() {
  const view = renderWithWallet(<WithdrawDialog chain="sepolia" account={SESSION} />, undefined, fakeChain().transport);
  await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Withdraw all" }));
  return { user, dialog: screen.getByRole("dialog") };
}

describe("WithdrawDialog", () => {
  it("names where the money goes: the connected main wallet, in full", async () => {
    const { dialog } = await open();
    expect(dialog).toHaveTextContent(new RegExp(`Destination: ${TEST_USER}`, "i"));
  });

  it("sends everything to the main wallet, from the trading wallet, with every candidate token", async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    await waitFor(() => expect(withdraw.withdrawAll).toHaveBeenCalledOnce());
    const args = withdraw.withdrawAll.mock.calls[0]![0];
    expect(args.account).toBe(SESSION);
    expect(args.to.toLowerCase()).toBe(TEST_USER);
    expect(args.connectedMain.toLowerCase()).toBe(TEST_USER);
    expect(args.candidateTokens).toEqual([T1]);
  });

  it("says what was sent", async () => {
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    expect(await within(dialog).findByText("Sent 2 tokens and 0.3 ETH to your main wallet.")).toBeInTheDocument();
  });

  it("says so when there was nothing to send", async () => {
    withdraw.withdrawAll.mockResolvedValue({ tokens: 0, ethSent: 0n, failed: [] });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    expect(await within(dialog).findByText("There is nothing left in your trading wallet.")).toBeInTheDocument();
  });

  it("does NOT claim success when some tokens could not be sent: it lists them and keeps the button to try again", async () => {
    withdraw.withdrawAll.mockResolvedValue({ tokens: 1, ethSent: 0n, failed: [{ token: T1, reason: "transfer_failed" }], ethKept: "token_failures" });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    expect(await within(dialog).findByText("1 token could not be sent and is still in your trading wallet:")).toBeInTheDocument();
    expect(within(dialog).getByText(T1)).toBeInTheDocument();
    expect(within(dialog).getByText("Your ETH was kept, to pay for another try. Press the button again.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Sent .* to your main wallet\.$/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Withdraw everything" })).toBeEnabled();
  });

  it("mentions ETH too small to move", async () => {
    withdraw.withdrawAll.mockResolvedValue({ tokens: 0, ethSent: 0n, failed: [], ethKept: "dust" });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    expect(await within(dialog).findByText("The ETH left is too small to be worth sending.")).toBeInTheDocument();
  });

  it("cannot be pressed twice while it is working", async () => {
    withdraw.withdrawAll.mockReturnValue(new Promise(() => {}));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Withdraw everything" })).toBeDisabled());
    expect(withdraw.withdrawAll).toHaveBeenCalledOnce();
  });

  it("explains an unexpected failure in words and lets the person try again", async () => {
    withdraw.withdrawAll.mockRejectedValue(new Error("boom with details"));
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Withdraw everything" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(dialog).not.toHaveTextContent("boom with details");
    expect(within(dialog).getByRole("button", { name: "Withdraw everything" })).toBeEnabled();
  });
});
