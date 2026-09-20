import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { ClaimFees } from "./claim-fees";

const claim = vi.hoisted(() => ({ claimCreatorFees: vi.fn() }));
const fees = vi.hoisted(() => ({ value: undefined as bigint | undefined }));
vi.mock("@/lib/profile/claim", () => claim);
vi.mock("@/lib/chain/use-creator-fees", () => ({ useCreatorFees: () => ({ fees: fees.value, refetch: vi.fn() }) }));

const OTHER = "0x00000000000000000000000000000000000000ff";

beforeEach(() => {
  localStorage.clear();
  claim.claimCreatorFees.mockReset().mockResolvedValue({ hash: `0x${"cd".repeat(32)}` });
  fees.value = 1_500_000_000_000_000_000n;
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
});

async function show(address: string, connected = true) {
  const wallet = renderWithWallet(<ClaimFees chain="sepolia" address={address} />);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}

// Review Focus 5: the button appears only when there is something to claim.
describe("ClaimFees", () => {
  it("draws nothing when there is nothing to claim", async () => {
    fees.value = 0n;
    const { container } = await show(TEST_USER);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws nothing until the amount is known: an unread amount is not an amount", async () => {
    fees.value = undefined;
    const { container } = await show(TEST_USER);
    expect(container.innerHTML).toBe("");
  });

  it("shows the amount and the button when the viewer owns the address and fees are positive", async () => {
    await show(TEST_USER);
    expect(await screen.findByText("1.5 ETH is waiting for you.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim creator fees" })).toBeInTheDocument();
  });

  // claimCreatorFees is permissionless and always pays the creator, so this is a UI choice, not a security boundary:
  // showing it would imply the viewer receives the money.
  it("hides it when viewing someone else's profile, even with fees outstanding", async () => {
    const { container } = await show(OTHER);
    expect(container.innerHTML).toBe("");
  });

  it("hides it for a stranger with no wallet", async () => {
    const { container } = await show(TEST_USER, false);
    expect(container.innerHTML).toBe("");
  });

  it("matches the profile's address whatever its case", async () => {
    await show(TEST_USER.toUpperCase().replace("0X", "0x"));
    expect(await screen.findByRole("button", { name: "Claim creator fees" })).toBeInTheDocument();
  });

  it("claims for the profile's address on the click, and says so", async () => {
    await show(TEST_USER);
    expect(claim.claimCreatorFees).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Claim creator fees" }));
    await waitFor(() => expect(claim.claimCreatorFees).toHaveBeenCalledTimes(1));
    const [deps, creator] = claim.claimCreatorFees.mock.calls[0]!;
    expect(creator.toLowerCase()).toBe(TEST_USER);
    expect(deps).toMatchObject({
      launchpad: "0x00000000000000000000000000000000000000c3",
      quote: "0x00000000000000000000000000000000000000e5",
      expectedChainId: 11155111,
    });
    expect(await screen.findByText("Claimed.")).toBeInTheDocument();
  });

  it("stays quiet when the person declines in their wallet, and says why in a sentence when it fails", async () => {
    claim.claimCreatorFees.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: 4001 }));
    await show(TEST_USER);
    await userEvent.click(await screen.findByRole("button", { name: "Claim creator fees" }));
    await waitFor(() => expect(claim.claimCreatorFees).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    claim.claimCreatorFees.mockRejectedValueOnce(new Error("execution reverted: /home/secret"));
    await userEvent.click(screen.getByRole("button", { name: "Claim creator fees" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/secret|home/);
  });
});
