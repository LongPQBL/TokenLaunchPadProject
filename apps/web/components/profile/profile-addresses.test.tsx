import { act, screen } from "@testing-library/react";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithWallet, TEST_USER } from "../../test/wallet";
import { ProfileAddresses } from "./profile-addresses";

const session = vi.hoisted(() => ({ account: undefined as { address: string } | undefined }));
vi.mock("@/lib/session/use-session", () => ({
  useSession: () => ({ status: session.account ? "ready" : "off", account: session.account }),
}));

const SESSION = "0x00000000000000000000000000000000000000d5";
const OTHER = "0x00000000000000000000000000000000000000ff";

beforeEach(() => {
  localStorage.clear();
  session.account = undefined;
});

async function show(address: string, connected = true) {
  const wallet = renderWithWallet(<ProfileAddresses chain="sepolia" address={address} />);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}

describe("ProfileAddresses", () => {
  it("shows the address the profile is about, in full, whoever is looking", async () => {
    await show(OTHER, false);
    expect(screen.getByText(OTHER)).toBeInTheDocument();
  });

  it("lists both the main and the trading address to their owner when a session wallet exists (spec 7.4)", async () => {
    session.account = { address: SESSION };
    await show(TEST_USER);
    expect(await screen.findByText("Main wallet")).toBeInTheDocument();
    expect(screen.getByText("Trading wallet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: SESSION })).toHaveAttribute("href", `/sepolia/profile/${SESSION}`);
  });

  it("lists only the main address when there is no session wallet", async () => {
    await show(TEST_USER);
    expect(screen.queryByText("Trading wallet")).toBeNull();
  });

  it("never shows a viewer's trading address on someone else's profile", async () => {
    session.account = { address: SESSION };
    await show(OTHER);
    expect(screen.queryByText(SESSION)).toBeNull();
    expect(screen.queryByText("Trading wallet")).toBeNull();
  });
});
