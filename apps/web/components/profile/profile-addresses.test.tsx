import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionContext, type SessionValue } from "@/lib/session/use-session";
import { embeddedConnector, externalConnector, testWallet, TEST_USER } from "../../test/wallet";
import { ProfileAddresses } from "./profile-addresses";

const TRADING = privateKeyToAccount(generatePrivateKey());
const OTHER = "0x00000000000000000000000000000000000000ff";
const ready: SessionValue = { status: "ready", account: TRADING, main: TEST_USER, enable: async () => true };

beforeEach(() => localStorage.clear());

async function show(address: string, o: { connector?: "external" | "embedded" | "none"; session?: SessionValue } = {}) {
  const connector = o.connector ?? "external";
  const wallet = testWallet([connector === "embedded" ? embeddedConnector(TEST_USER) : externalConnector()]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <wallet.wrapper>
      <SessionContext.Provider value={o.session ?? ready}>{children}</SessionContext.Provider>
    </wallet.wrapper>
  );
  render(<ProfileAddresses chain="sepolia" address={address} />, { wrapper });
  if (connector !== "none") await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
}

describe("ProfileAddresses", () => {
  it("shows the address the profile is about, in full, whoever is looking", async () => {
    await show(OTHER, { connector: "none" });
    expect(screen.getByText(OTHER)).toBeInTheDocument();
  });

  it("names the main wallet behind the trading wallet to the owner of the profile: the profile is the TRADING wallet's", async () => {
    await show(TRADING.address);
    expect(await screen.findByText("Trading wallet")).toBeInTheDocument();
    expect(screen.getByText(TRADING.address)).toBeInTheDocument();
    expect(screen.getByText("Main wallet")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${TEST_USER}$`, "i"))).toBeInTheDocument();
  });

  it("does not name the main wallet on the main wallet's own address: that is not who the person is here", async () => {
    await show(TEST_USER);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.queryByText("Main wallet")).toBeNull();
    expect(screen.queryByText("Trading wallet")).toBeNull();
  });

  it("never names anyone's main wallet on someone else's profile", async () => {
    await show(OTHER);
    expect(screen.queryByText("Main wallet")).toBeNull();
    expect(screen.queryByText(new RegExp(TEST_USER, "i"))).toBeNull();
  });

  it("shows one plain address while the trading wallet is not open: there is no owner yet", async () => {
    await show(TRADING.address, { session: { status: "needs-signature", account: undefined, main: TEST_USER, enable: async () => true } });
    expect(screen.queryByText("Main wallet")).toBeNull();
  });
});

describe("ProfileAddresses for a wallet that signs by itself", () => {
  it("shows one address, and no main wallet: it has only the one", async () => {
    await show(TEST_USER, { connector: "embedded", session: { status: "none", account: undefined, main: undefined, enable: async () => false } });
    expect(screen.getByText(TEST_USER)).toBeInTheDocument();
    expect(screen.queryByText("Main wallet")).toBeNull();
    expect(screen.queryByText("Trading wallet")).toBeNull();
  });
});
