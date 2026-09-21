import { act, renderHook, waitFor } from "@testing-library/react";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { describe, expect, it } from "vitest";
import { TEST_USER, testWallet } from "../../test/wallet";
import { EMBEDDED_CONNECTOR_PREFIX, embeddedConnectorId, isEmbeddedConnector, useWalletKind } from "./wallet-kind";

/** A mock wallet that calls itself something else, the way Privy's embedded wallet announces its own id. */
const named = (id: string) => (config: Parameters<ReturnType<typeof mock>>[0]) => ({ ...mock({ accounts: [TEST_USER] })(config), id });

describe("isEmbeddedConnector", () => {
  const ME = "0x00000000000000000000000000000000000000A1";

  it("knows Privy's embedded wallet by its real id, which carries the wallet's own address", () => {
    expect(EMBEDDED_CONNECTOR_PREFIX).toBe("io.privy.wallet.");
    expect(isEmbeddedConnector({ id: embeddedConnectorId(ME) }, ME)).toBe(true);
    expect(isEmbeddedConnector({ id: `io.privy.wallet.${ME.toLowerCase()}` }, ME)).toBe(true); // the address part is compared without case
  });

  // Found by logging in for real: the bare family name is not any connector's id.
  it("is not fooled by the bare family name, which is what an earlier version wrongly expected", () => {
    expect(isEmbeddedConnector({ id: "io.privy.wallet" }, ME)).toBe(false);
  });

  it("refuses everything that only looks like it: another address, junk, other prefixes and cases, and no account", () => {
    const other = "0x00000000000000000000000000000000000000B7";
    for (const id of [embeddedConnectorId(other), "io.privy.wallet.evil", "io.privy.wallet.", "io.privy.smart", "io.metamask", "injected", "walletConnect", "IO.PRIVY.WALLET." + ME, `io.privy.wallet.${ME}x`, ""]) {
      expect(isEmbeddedConnector({ id }, ME), id).toBe(false);
    }
    expect(isEmbeddedConnector({ id: embeddedConnectorId(ME) }, undefined)).toBe(false);
    expect(isEmbeddedConnector(undefined, ME)).toBe(false);
  });
});

describe("useWalletKind", () => {
  async function kindWith(id: string | undefined) {
    const wallet = testWallet(id ? [named(id)] : []);
    const hook = renderHook(() => useWalletKind(), { wrapper: wallet.wrapper });
    if (id) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
    return hook;
  }

  it("is none while no wallet is connected", async () => {
    const { result } = await kindWith(undefined);
    expect(result.current).toBe("none");
  });

  it("is external for a wallet that is not Privy's embedded one", async () => {
    const { result } = await kindWith("io.metamask");
    await waitFor(() => expect(result.current).toBe("external"));
  });

  it("is embedded for Privy's embedded wallet", async () => {
    const { result } = await kindWith(embeddedConnectorId(TEST_USER));
    await waitFor(() => expect(result.current).toBe("embedded"));
  });

  it("is external when the id names some OTHER address: an extension can announce any id it likes, so the id must be about this account", async () => {
    const { result } = await kindWith(embeddedConnectorId("0x00000000000000000000000000000000000000B7"));
    await waitFor(() => expect(result.current).toBe("external"));
  });

  it("is external for a look-alike id, so a hostile wallet cannot claim to be the embedded one", async () => {
    const { result } = await kindWith("io.privy.wallet.evil");
    await waitFor(() => expect(result.current).toBe("external"));
  });
});
