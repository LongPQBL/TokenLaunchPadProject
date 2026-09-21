import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";
import { connect, disconnect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { embeddedConnector, externalConnector, testWallet, TEST_USER } from "../../test/wallet";
import { deriveSessionAccount, SESSION_MESSAGE } from "./derive";
import { SessionProvider, useSession } from "./use-session";

const SIG_A = `0x${"ab".repeat(65)}` as const;
const SIG_B = `0x${"cd".repeat(65)}` as const;
const signer = vi.hoisted(() => ({ signMessageAsync: vi.fn() }));
vi.mock("wagmi", async (importOriginal) => ({ ...(await importOriginal<typeof import("wagmi")>()), useSignMessage: () => signer }));

beforeEach(() => {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  signer.signMessageAsync.mockReset().mockResolvedValue(SIG_A);
});

async function setup(connected = true) {
  const wallet = testWallet([externalConnector()]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <wallet.wrapper>
      <SessionProvider>{children}</SessionProvider>
    </wallet.wrapper>
  );
  const hook = renderHook(() => useSession(), { wrapper });
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return { ...hook, ...wallet, wrapper };
}

describe("useSession", () => {
  it("has no session, and asks for nothing, while no wallet is connected", async () => {
    const { result } = await setup(false);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.status).toBe("none");
    expect(result.current.account).toBeUndefined();
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });

  it("opens the trading wallet by itself when a wallet connects: ONE signature over the fixed message, and the derived wallet", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(signer.signMessageAsync).toHaveBeenCalledOnce();
    expect(signer.signMessageAsync).toHaveBeenCalledWith({ message: SESSION_MESSAGE });
    expect(result.current.account?.address).toBe(deriveSessionAccount(SIG_A).address);
  });

  it("says which wallet it belongs to and funds it from: the connected one", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.main?.toLowerCase()).toBe(TEST_USER);
  });

  it("comes back ready after a reload with NO signature: the wallet is restored from storage", async () => {
    const first = await setup();
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    const address = first.result.current.account?.address;
    first.unmount();
    signer.signMessageAsync.mockClear();

    const second = await setup();
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.account?.address).toBe(address);
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });

  it("asks for one signature again when the browser has lost the stored key, and that brings back the very same wallet", async () => {
    const first = await setup();
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    globalThis.indexedDB = new IDBFactory(); // the browser dropped its site data
    signer.signMessageAsync.mockClear();

    const second = await setup();
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(signer.signMessageAsync).toHaveBeenCalledOnce();
    expect(second.result.current.account?.address).toBe(deriveSessionAccount(SIG_A).address);
  });

  it("waits for the person, and says so, when they decline to sign: it does not ask again by itself, and never trades from the main wallet instead", async () => {
    signer.signMessageAsync.mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result } = await setup();
    await waitFor(() => expect(result.current.status).toBe("needs-signature"));
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(signer.signMessageAsync).toHaveBeenCalledOnce(); // not a loop
    expect(result.current.account).toBeUndefined();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("vezta.session"))).toEqual([]); // (wagmi keeps its own keys)
  });

  it("does not ask a wallet that declined again when it reconnects during the same visit", async () => {
    signer.signMessageAsync.mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result, config } = await setup();
    await waitFor(() => expect(result.current.status).toBe("needs-signature"));
    await act(() => disconnect(config));
    await waitFor(() => expect(result.current.status).toBe("none"));
    await act(() => connect(config, { connector: config.connectors[0]!, chainId: sepolia.id }));
    await waitFor(() => expect(result.current.status).toBe("needs-signature"));
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(signer.signMessageAsync).toHaveBeenCalledOnce();
  });

  it("opens it when the person asks after declining, with the same one signature", async () => {
    signer.signMessageAsync.mockRejectedValueOnce(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result } = await setup();
    await waitFor(() => expect(result.current.status).toBe("needs-signature"));
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.enable();
    });
    expect(outcome).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.account?.address).toBe(deriveSessionAccount(SIG_A).address);
  });

  it("reports a mismatch, and does not make a second wallet, when the main wallet signs differently than before", async () => {
    const first = await setup();
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    globalThis.indexedDB = new IDBFactory();
    signer.signMessageAsync.mockResolvedValue(SIG_B);

    const second = await setup();
    await waitFor(() => expect(second.result.current.status).toBe("mismatch"));
    expect(second.result.current.account).toBeUndefined();
  });

  it("does not ask the main wallet for a signature again once it has asked, for the same wallet, during one visit", async () => {
    const { result, config } = await setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => disconnect(config));
    await waitFor(() => expect(result.current.status).toBe("none"));
    signer.signMessageAsync.mockClear();
    await act(() => connect(config, { connector: config.connectors[0]!, chainId: sepolia.id }));
    await waitFor(() => expect(result.current.status).toBe("ready")); // restored from storage
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });

  it("belongs to the connected main wallet: with none connected there is no session", async () => {
    const { result, config } = await setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => disconnect(config));
    await waitFor(() => expect(result.current.status).toBe("none"));
    expect(result.current.account).toBeUndefined();
  });

  it("does nothing, and says no, when asked to open with no wallet connected", async () => {
    const { result } = await setup(false);
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.enable();
    });
    expect(outcome).toBe(false);
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });
});

describe("useSession with a wallet that signs by itself", () => {
  it("has no session at all: an embedded wallet IS the trading wallet, and is never asked to sign for one", async () => {
    const wallet = testWallet([embeddedConnector(TEST_USER)]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <wallet.wrapper>
        <SessionProvider>{children}</SessionProvider>
      </wallet.wrapper>
    );
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(result.current.status).toBe("none");
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });
});
