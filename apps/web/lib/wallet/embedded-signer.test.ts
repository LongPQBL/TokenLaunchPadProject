import { launchpadAbi } from "@vezta/abi";
import { encodeAbiParameters, encodeEventTopics, parseTransaction, recoverTransactionAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { createEmbeddedWalletClient } from "./embedded-signer";
import { createSelfCustody, isUserRejection } from "./self-custody";

const owner = privateKeyToAccount(generatePrivateKey()); // random: never a well-known key
const TOKEN = "0x00000000000000000000000000000000000000b2" as Address;
const LAUNCHPAD = "0x00000000000000000000000000000000000000c3" as Address;
const FACTORY = "0x00000000000000000000000000000000000000d4" as Address;
const WETH = "0x00000000000000000000000000000000000000e5" as Address;
const CHAIN = 11155111;
const HASH = `0x${"ab".repeat(32)}` as Hex;

/**
 * Stands in for Privy's provider, and rejects what Privy rejects (found in the spike): `type` must be the number 2, and every
 * quantity a hex string. It signs for real, with a random key, so what comes back is a transaction that can be inspected.
 */
function fakePrivy() {
  const requests: { method: string; params: unknown[] }[] = [];
  return {
    requests,
    async request({ method, params = [] }: { method: string; params?: unknown[] }) {
      requests.push({ method, params });
      if (method !== "eth_signTransaction") throw new Error(`unexpected method ${method}`);
      const tx = params[0] as Record<string, unknown>;
      if (tx.type !== 2) throw new Error("params.transaction.type: Invalid literal value, expected 2");
      for (const k of ["value", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "chainId"]) {
        if (typeof tx[k] !== "string" || !/^0x[0-9a-f]+$/.test(tx[k] as string))
          throw new Error(`params.transaction.${k}: expected a hex quantity`);
      }
      if ((tx.from as string).toLowerCase() !== owner.address.toLowerCase()) throw new Error("wrong account");
      return owner.signTransaction({
        chainId: Number(BigInt(tx.chainId as Hex)),
        type: "eip1559",
        to: tx.to as Hex,
        data: tx.data as Hex,
        value: BigInt(tx.value as Hex),
        nonce: Number(BigInt(tx.nonce as Hex)),
        gas: BigInt(tx.gas as Hex),
        maxFeePerGas: BigInt(tx.maxFeePerGas as Hex),
        maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas as Hex),
      });
    },
  };
}

/** The chain as our own RPC answers: it decides the nonce, the gas and the fees; nothing is tracked locally. */
function fakeChain(over: { nonce?: number } = {}) {
  const sent: Hex[] = [];
  const prepared: unknown[] = [];
  return {
    sent,
    prepared,
    publicClient: {
      prepareTransactionRequest: vi.fn(async (a: Record<string, unknown>) => {
        prepared.push(a);
        return { ...a, nonce: over.nonce ?? 7, gas: 210_000n, maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
      }),
      sendRawTransaction: vi.fn(async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
        sent.push(serializedTransaction);
        return HASH;
      }),
    },
  };
}

const build = (
  o: {
    provider?: ReturnType<typeof fakePrivy>;
    chain?: ReturnType<typeof fakeChain>;
    account?: Address | undefined;
    chainId?: number | undefined;
  } = {},
) => {
  const provider = o.provider ?? fakePrivy();
  const chain = o.chain ?? fakeChain();
  const client = createEmbeddedWalletClient({
    provider,
    publicClient: chain.publicClient as never,
    account: "account" in o ? o.account : owner.address,
    chainId: "chainId" in o ? o.chainId : CHAIN,
    expectedChainId: CHAIN,
  });
  return { client, provider, chain };
};

const buy = {
  address: LAUNCHPAD,
  abi: launchpadAbi,
  functionName: "buyWithEth",
  args: [TOKEN, 10n ** 18n, 5n * 10n ** 15n],
  value: 5n * 10n ** 15n,
} as never;

describe("createEmbeddedWalletClient", () => {
  it("has the embedded wallet sign ONE transaction, and broadcasts exactly what it signed", async () => {
    const { client, provider, chain } = build();
    const hash = await client.writeContract(buy);
    expect(hash).toBe(HASH);
    expect(provider.requests.map((r) => r.method)).toEqual(["eth_signTransaction"]);
    expect(chain.sent).toHaveLength(1);
    const tx = parseTransaction(chain.sent[0]! as `0x02${string}`);
    expect(tx).toMatchObject({ chainId: CHAIN, type: "eip1559", value: 5n * 10n ** 15n, nonce: 7, gas: 210_000n });
    expect(tx.to?.toLowerCase()).toBe(LAUNCHPAD.toLowerCase());
    expect(await recoverTransactionAddress({ serializedTransaction: chain.sent[0]! as `0x02${string}` })).toBe(owner.address);
  });

  it("asks in the shape Privy accepts: type the NUMBER 2, and quantities as hex strings", async () => {
    const { client, provider } = build();
    await client.writeContract(buy);
    const tx = provider.requests[0]!.params[0] as Record<string, unknown>;
    expect(tx.type).toBe(2);
    expect(tx).toMatchObject({
      value: "0x11c37937e08000",
      nonce: "0x7",
      gas: "0x33450",
      maxFeePerGas: "0xb2d05e00",
      maxPriorityFeePerGas: "0x3b9aca00",
      chainId: "0xaa36a7",
    });
    expect(tx.from).toBe(owner.address);
  });

  it("takes nonce, gas and fees from the chain's own answer, keeping no count of its own", async () => {
    const chain = fakeChain({ nonce: 41 });
    const { client, provider } = build({ chain });
    await client.writeContract(buy);
    expect((provider.requests[0]!.params[0] as { nonce: string }).nonce).toBe("0x29");
    expect(chain.prepared[0]).toMatchObject({ account: owner.address, to: LAUNCHPAD });
    chain.publicClient.prepareTransactionRequest.mockImplementationOnce(async (a: Record<string, unknown>) => ({
      ...a,
      nonce: 5,
      gas: 1n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    }));
    await client.writeContract(buy);
    expect((provider.requests[1]!.params[0] as { nonce: string }).nonce).toBe("0x5"); // the chain said 5, so 5
  });

  // Review Focus 3: never sign for another chain or without an account.
  it("refuses, before asking the wallet anything, when the wallet is on another chain", async () => {
    const { client, provider, chain } = build({ chainId: 1 });
    await expect(client.writeContract(buy)).rejects.toMatchObject({ name: "TradeError", code: "wrong_chain" });
    expect(provider.requests).toEqual([]);
    expect(chain.sent).toEqual([]);
  });

  it("refuses when no chain is known, and when nobody is logged in", async () => {
    const a = build({ chainId: undefined });
    await expect(a.client.writeContract(buy)).rejects.toMatchObject({ code: "wrong_chain" });
    const b = build({ account: undefined });
    await expect(b.client.writeContract(buy)).rejects.toMatchObject({ code: "not_connected" });
    expect(a.provider.requests.concat(b.provider.requests)).toEqual([]);
  });

  it("signs for the deployment's chain id, whatever the wallet's own chain says", async () => {
    const { client, provider } = build();
    await client.writeContract(buy);
    expect((provider.requests[0]!.params[0] as { chainId: string }).chainId).toBe("0xaa36a7");
  });

  it("lets a refusal in the wallet through untouched, and broadcasts nothing", async () => {
    const rejection = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const provider = { requests: [], request: async () => Promise.reject(rejection) } as unknown as ReturnType<typeof fakePrivy>;
    const chain = fakeChain();
    const { client } = build({ provider, chain });
    const error = await client.writeContract(buy).catch((e: unknown) => e);
    expect(isUserRejection(error)).toBe(true);
    expect(chain.sent).toEqual([]);
  });

  it("does not broadcast when signing fails for any other reason, and says nothing of a raw transaction", async () => {
    const provider = { requests: [], request: async () => Promise.reject(new Error("signing failed")) } as unknown as ReturnType<
      typeof fakePrivy
    >;
    const chain = fakeChain();
    const { client } = build({ provider, chain });
    await expect(client.writeContract(buy)).rejects.toThrow("signing failed");
    expect(chain.sent).toEqual([]);
  });

  it("does not offer batching: it is never used with this wallet", async () => {
    const { client } = build();
    await expect(client.sendCalls({} as never)).rejects.toBeInstanceOf(Error);
    await expect(client.waitForCallsStatus({} as never)).rejects.toBeInstanceOf(Error);
  });
});

/** A real Trade log, so the production parser reads it. */
function tradeLog() {
  const topics = encodeEventTopics({ abi: launchpadAbi, eventName: "Trade", args: { mint: TOKEN, user: owner.address } });
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "bool" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [10n ** 15n, 10n ** 18n, false, 1_700_000_000n, 10n, 20n, 1n, 0n],
  );
  return {
    address: LAUNCHPAD,
    topics,
    data,
    blockNumber: 1n,
    transactionHash: HASH,
    logIndex: 0,
    blockHash: HASH,
    transactionIndex: 0,
    removed: false,
  };
}

describe("through the trade seam", () => {
  function seam(allowance: bigint) {
    const { client, provider, chain } = build();
    const trade = createSelfCustody({
      deployment: { launchpad: LAUNCHPAD, factory: FACTORY, weth: WETH },
      expectedChainId: CHAIN,
      account: owner.address,
      chainId: CHAIN,
      walletClient: client as never,
      kind: "embedded",
      canBatch: false,
      publicClient: {
        readContract: async ({ functionName }: { functionName: string }) => (functionName === "allowance" ? allowance : 0n),
        waitForTransactionReceipt: async () => ({ status: "success", logs: [tradeLog()] }),
      } as never,
    });
    return { trade, provider, chain };
  }

  it("is a zero-prompt signer", () => {
    expect(seam(0n).trade.capabilities).toMatchObject({ kind: "embedded", isZeroPrompt: true, canBatch: false, address: owner.address });
  });

  it("approves and then sells as the panel's two steps do: two silent signatures, no batch", async () => {
    const { trade, provider, chain } = seam(0n);
    await trade.approveIfNeeded({ token: TOKEN, amount: 10n ** 18n });
    const result = await trade.sell({ token: TOKEN, amount: 10n ** 18n, minQuoteOutput: 1n });
    expect(provider.requests).toHaveLength(2);
    expect(chain.sent).toHaveLength(2);
    const [approve, sell] = chain.sent.map((raw) => parseTransaction(raw as `0x02${string}`));
    expect(approve!.to?.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(approve!.data?.startsWith("0x095ea7b3")).toBe(true); // approve(address,uint256)
    expect(sell!.to?.toLowerCase()).toBe(LAUNCHPAD.toLowerCase());
    expect(result.tokenAmount).toBe(10n ** 18n); // read from the Trade event, not from the request
  });

  it("skips the approval when the allowance already covers the sale", async () => {
    const { trade, provider } = seam(10n ** 30n);
    await trade.approveIfNeeded({ token: TOKEN, amount: 10n ** 18n });
    await trade.sell({ token: TOKEN, amount: 10n ** 18n, minQuoteOutput: 1n });
    expect(provider.requests).toHaveLength(1);
  });
});
