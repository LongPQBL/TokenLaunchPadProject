import type { Page } from "@playwright/test";
import { createWalletClient, hexToBigInt, http, isHex, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/**
 * A wallet for the browser, driven from the test. The page gets a real EIP-1193 provider (announced over EIP-6963, the
 * way MetaMask announces itself, so the app discovers it like any other wallet); every request is answered here, in
 * Node, with a freshly generated key. Signing and sending are REAL: the transaction goes to the local fork and mines.
 *
 * The key is random and funded with anvil_setBalance. A well-known Anvil key is never used, because ETH sent to one
 * can be swept by bots on any network that shares it, and a fork inherits their delegations.
 */
/**
 * Playwright hands an error across to the page as its message only: a `code` property is lost on the way. The code is
 * therefore written into the message, and the page-side provider turns it back into a `code`, as a real wallet has.
 */
const walletError = (code: number, message: string) => new Error(`[code:${code}] ${message}`);

export async function installWallet(page: Page, rpcUrl: string, options: { balanceEth?: number; privateKey?: Hex } = {}) {
  const account = privateKeyToAccount(options.privateKey ?? generatePrivateKey());
  const client = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const rpc = async (method: string, params: unknown[] = []) => {
    const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = (await res.json()) as { result?: unknown; error?: { message: string; code: number } };
    if (body.error) throw walletError(body.error.code, body.error.message);
    return body.result;
  };

  await rpc("anvil_setBalance", [account.address, toHex(BigInt(Math.round((options.balanceEth ?? 10) * 1e18)))]);

  // Like a real wallet, it reveals its account only after the person has agreed to connect: eth_accounts is empty until
  // eth_requestAccounts, or the app would find it already connected before anyone clicked anything.
  const state = { rejectNext: false, authorized: false, requests: [] as string[] };

  await page.exposeFunction("__walletRequest", async (method: string, params: unknown[]) => {
    state.requests.push(method);
    switch (method) {
      case "eth_requestAccounts":
        state.authorized = true;
        return [account.address];
      case "eth_accounts":
        return state.authorized ? [account.address] : [];
      case "eth_chainId":
        return toHex(sepolia.id);
      case "wallet_switchEthereumChain":
        return null;
      case "personal_sign": {
        if (state.rejectNext) {
          state.rejectNext = false;
          throw walletError(4001, "User rejected the request.");
        }
        const [message] = params as [Hex];
        return account.signMessage({ message: { raw: message } });
      }
      case "eth_sendTransaction": {
        if (state.rejectNext) {
          state.rejectNext = false;
          throw walletError(4001, "User rejected the request.");
        }
        const tx = (params as [Record<string, unknown>])[0]!;
        const big = (v: unknown) => (isHex(v) ? hexToBigInt(v) : undefined);
        return client.sendTransaction({
          to: tx.to as Hex,
          data: tx.data as Hex | undefined,
          value: big(tx.value),
          gas: big(tx.gas),
        });
      }
      case "wallet_getCapabilities":
        // This wallet does not batch: the two-step approve-then-sell path is what a plain wallet gets.
        throw walletError(4200, "Method not supported");
      default:
        return rpc(method, params); // reads go straight to the fork
    }
  });

  await page.addInitScript(() => {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const provider = {
      isE2EWallet: true,
      async request({ method, params }: { method: string; params?: unknown[] }) {
        try {
          return await (window as unknown as { __walletRequest: (m: string, p: unknown[]) => Promise<unknown> }).__walletRequest(method, params ?? []);
        } catch (e) {
          const raw = String((e as { message?: string }).message ?? "Wallet error");
          const match = /\[code:(-?\d+)\]\s*/.exec(raw);
          throw Object.assign(new Error(raw.replace(/\[code:-?\d+\]\s*/, "")), { code: match ? Number(match[1]) : -32603 });
        }
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(fn);
      },
      removeListener(event: string, fn: (...args: unknown[]) => void) {
        listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
      },
    };
    const info = { uuid: "e2e-wallet", name: "E2E Wallet", icon: "data:image/svg+xml;base64,PHN2Zy8+", rdns: "test.e2e.wallet" };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    (window as unknown as { ethereum: unknown }).ethereum = provider;
  });

  return {
    address: account.address,
    /** Makes the next signing or sending request fail the way a person clicking "Reject" does. */
    rejectNext() {
      state.rejectNext = true;
    },
    requests: state.requests,
    rpc,
  };
}
