import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";
import { connect, disconnect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testWallet } from "../../test/wallet";
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
  const wallet = testWallet();
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
  it("is off until the person turns it on: trading is with their own wallet", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.status).toBe("off"));
    expect(result.current.account).toBeUndefined();
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });

  it("turning it on asks the main wallet for ONE signature over the fixed message, and gives the derived wallet", async () => {
    const { result } = await setup();
    await act(async () => void (await result.current.enable()));
    expect(signer.signMessageAsync).toHaveBeenCalledOnce();
    expect(signer.signMessageAsync).toHaveBeenCalledWith({ message: SESSION_MESSAGE });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.account?.address).toBe(deriveSessionAccount(SIG_A).address);
  });

  it("comes back ready after a reload with NO signature: the wallet is restored from storage", async () => {
    const first = await setup();
    await act(async () => void (await first.result.current.enable()));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    const address = first.result.current.account?.address;
    first.unmount();
    signer.signMessageAsync.mockClear();

    const second = await setup();
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.account?.address).toBe(address);
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });

  it("asks for a signature again, rather than falling back to the main wallet, when it was on but its stored key is gone", async () => {
    const first = await setup();
    await act(async () => void (await first.result.current.enable()));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    globalThis.indexedDB = new IDBFactory(); // the browser dropped its site data

    const second = await setup();
    await waitFor(() => expect(second.result.current.status).toBe("needs-signature"));
    expect(second.result.current.account).toBeUndefined();
    // and one signature brings back the very same wallet
    await act(async () => void (await second.result.current.enable()));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.account?.address).toBe(deriveSessionAccount(SIG_A).address);
  });

  it("stays off, and says no, when the person declines to sign", async () => {
    signer.signMessageAsync.mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result } = await setup();
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.enable();
    });
    expect(outcome).toBe(false);
    expect(result.current.status).toBe("off");
    expect(Object.keys(localStorage).filter((k) => k.startsWith("vezta.session"))).toEqual([]); // (wagmi keeps its own keys)
  });

  it("reports a mismatch, and does not make a second wallet, when the main wallet signs differently than before", async () => {
    const first = await setup();
    await act(async () => void (await first.result.current.enable()));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();
    globalThis.indexedDB = new IDBFactory();
    signer.signMessageAsync.mockResolvedValue(SIG_B);

    const second = await setup();
    await waitFor(() => expect(second.result.current.status).toBe("needs-signature"));
    await act(async () => void (await second.result.current.enable()));
    await waitFor(() => expect(second.result.current.status).toBe("mismatch"));
    expect(second.result.current.account).toBeUndefined();
  });

  it("turning it off goes back to the main wallet and keeps the session wallet, with whatever it holds", async () => {
    const { result } = await setup();
    await act(async () => void (await result.current.enable()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.disable());
    await waitFor(() => expect(result.current.status).toBe("off"));
    // turning it back on needs no new signature
    signer.signMessageAsync.mockClear();
    await act(async () => void (await result.current.enable()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });

  it("stays off across a reload once it was turned off", async () => {
    const first = await setup();
    await act(async () => void (await first.result.current.enable()));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    act(() => first.result.current.disable());
    first.unmount();
    const second = await setup();
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(second.result.current.status).toBe("off");
  });

  it("belongs to the connected main wallet: with none connected there is no session", async () => {
    const { result, config } = await setup();
    await act(async () => void (await result.current.enable()));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(() => disconnect(config));
    await waitFor(() => expect(result.current.status).toBe("off"));
    expect(result.current.account).toBeUndefined();
  });

  it("does nothing, and says no, when enable is called with no wallet connected", async () => {
    const { result } = await setup(false);
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.enable();
    });
    expect(outcome).toBe(false);
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });
});
