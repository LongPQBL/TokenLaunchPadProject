import { launchpadAbi, tokenFactoryAbi } from "@vezta/abi";
import { BaseError, encodeAbiParameters, encodeEventTopics, maxUint256, UserRejectedRequestError, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createSelfCustody, type SelfCustodyDeps } from "./self-custody";
import { TradeError } from "./types";

const USER = "0x00000000000000000000000000000000000000a1" as Address;
const TOKEN = "0x00000000000000000000000000000000000000b2" as Address;
const LAUNCHPAD = "0x00000000000000000000000000000000000000c3" as Address;
const FACTORY = "0x00000000000000000000000000000000000000d4" as Address;
const WETH = "0x00000000000000000000000000000000000000e5" as Address;
const CHAIN = 11155111;
const HASH = ("0x" + "ab".repeat(32)) as Hex;

/** A real Trade log, encoded with the real ABI, so the parser under test is the production one. */
function tradeLog(o: { quoteAmount: bigint; tokenAmount: bigint; isBuy: boolean; fee: bigint; launchTax: bigint }) {
  const topics = encodeEventTopics({ abi: launchpadAbi, eventName: "Trade", args: { mint: TOKEN, user: USER } });
  const data = encodeAbiParameters(
    [
      { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" },
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    ],
    [o.quoteAmount, o.tokenAmount, o.isBuy, 1_700_000_000n, 10n, 20n, o.fee, o.launchTax],
  );
  return { address: LAUNCHPAD, topics, data, blockNumber: 1n, transactionHash: HASH, logIndex: 0, blockHash: HASH, transactionIndex: 0, removed: false };
}

function createdLog(token: Address) {
  const topics = encodeEventTopics({ abi: tokenFactoryAbi, eventName: "TokenCreated", args: { token, creator: USER, quoteToken: WETH } });
  const data = encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }], ["Name", "TCK", "ipfs://x"]);
  return { address: FACTORY, topics, data, blockNumber: 1n, transactionHash: HASH, logIndex: 0, blockHash: HASH, transactionIndex: 0, removed: false };
}

function setup(over: Partial<SelfCustodyDeps> & { logs?: unknown[]; status?: "success" | "reverted"; allowance?: bigint } = {}) {
  const writeContract = vi.fn<(call: unknown) => Promise<Hex>>(async () => HASH);
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "allowance") return over.allowance ?? 0n;
    if (functionName === "createFee") return 5_000_000_000_000_000n;
    throw new Error(`unexpected read ${functionName}`);
  });
  const waitForTransactionReceipt = vi.fn(async () => ({ status: over.status ?? "success", logs: over.logs ?? [] }));
  const deps = {
    deployment: { launchpad: LAUNCHPAD, factory: FACTORY, weth: WETH },
    expectedChainId: CHAIN,
    account: USER,
    chainId: CHAIN,
    walletClient: { writeContract },
    publicClient: { readContract, waitForTransactionReceipt },
    ...over,
  } as unknown as SelfCustodyDeps;
  return { trade: createSelfCustody(deps), writeContract, readContract, waitForTransactionReceipt };
}

const buyArgs = { token: TOKEN, amount: 10n ** 24n, maxQuoteCost: 10n ** 16n };

describe("capabilities", () => {
  it("is self-custody, and needs a prompt for every trade", () => {
    const { trade } = setup();
    expect(trade.capabilities).toMatchObject({ kind: "self-custody", address: USER, chainId: CHAIN, isZeroPrompt: false });
  });
});

describe("guards: nothing reaches the wallet unless it should", () => {
  it("with no wallet, the address is undefined and every method rejects not_connected", async () => {
    const { trade, writeContract } = setup({ account: undefined, chainId: undefined, walletClient: undefined });
    expect(trade.capabilities.address).toBeUndefined();
    for (const call of [
      () => trade.buyWithEth(buyArgs),
      () => trade.sell({ token: TOKEN, amount: 1n, minQuoteOutput: 1n }),
      () => trade.approveIfNeeded({ token: TOKEN, amount: 1n }),
      () => trade.createToken({ name: "n", ticker: "T", metadataURI: "ipfs://x", quoteToken: WETH, antiSniperWindow: 60 }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "not_connected" });
    }
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("on the wrong chain, rejects wrong_chain BEFORE the wallet is opened", async () => {
    const { trade, writeContract } = setup({ chainId: 1 });
    await expect(trade.buyWithEth(buyArgs)).rejects.toMatchObject({ code: "wrong_chain" });
    await expect(trade.sell({ token: TOKEN, amount: 1n, minQuoteOutput: 1n })).rejects.toMatchObject({ code: "wrong_chain" });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("refuses a slippage bound that protects nothing: 0 and maxUint256", async () => {
    const { trade, writeContract } = setup();
    for (const maxQuoteCost of [0n, maxUint256]) {
      await expect(trade.buyWithEth({ ...buyArgs, maxQuoteCost })).rejects.toMatchObject({ code: "bad_amount" });
    }
    await expect(trade.sell({ token: TOKEN, amount: 1n, minQuoteOutput: 0n })).rejects.toMatchObject({ code: "bad_amount" });
    await expect(trade.buyWithEth({ ...buyArgs, amount: 0n })).rejects.toMatchObject({ code: "bad_amount" });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("a user rejection is user_rejected, not an error to show", async () => {
    const { trade, writeContract } = setup();
    writeContract.mockRejectedValueOnce(new UserRejectedRequestError(new Error("User rejected the request.")));
    await expect(trade.buyWithEth(buyArgs)).rejects.toMatchObject({ name: "TradeError", code: "user_rejected" });
  });

  it("finds the rejection inside the wrapper viem puts around a failed writeContract", async () => {
    const { trade, writeContract } = setup();
    writeContract.mockRejectedValueOnce(new BaseError("Execution failed", { cause: new UserRejectedRequestError(new Error("no")) }));
    await expect(trade.buyWithEth(buyArgs)).rejects.toMatchObject({ code: "user_rejected" });
  });

  it("recognises EIP-1193 code 4001 from a wallet that does not use viem's class", async () => {
    const { trade, writeContract } = setup();
    writeContract.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: 4001 }));
    await expect(trade.buyWithEth(buyArgs)).rejects.toMatchObject({ code: "user_rejected" });
  });

  it("passes any other wallet failure through unchanged, for the error mapper to read", async () => {
    const { trade, writeContract } = setup();
    const boom = new Error("insufficient funds");
    writeContract.mockRejectedValueOnce(boom);
    await expect(trade.buyWithEth(buyArgs)).rejects.toBe(boom);
  });
});

describe("buyWithEth", () => {
  it("sends value = maxQuoteCost (the contract refunds the difference) and reports what the Trade event says", async () => {
    // Asked for 10^24 tokens; the curve was nearly full, so only 10^18 were sold.
    const { trade, writeContract } = setup({
      logs: [tradeLog({ quoteAmount: 900n, tokenAmount: 10n ** 18n, isBuy: true, fee: 9n, launchTax: 0n })],
    });
    const result = await trade.buyWithEth(buyArgs);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: LAUNCHPAD,
        functionName: "buyWithEth",
        args: [TOKEN, buyArgs.amount, buyArgs.maxQuoteCost],
        value: buyArgs.maxQuoteCost,
        account: USER,
      }),
    );
    expect(result).toEqual({ hash: HASH, tokenAmount: 10n ** 18n, quoteAmount: 900n, fee: 9n, launchTax: 0n });
  });

  it("fails loudly when the receipt has no Trade event, rather than inventing a result from the request", async () => {
    const { trade } = setup({ logs: [] });
    await expect(trade.buyWithEth(buyArgs)).rejects.toMatchObject({ code: "no_trade_event" });
  });

  it("fails with reverted when the transaction was mined but reverted", async () => {
    const { trade } = setup({ status: "reverted" });
    await expect(trade.buyWithEth(buyArgs)).rejects.toMatchObject({ code: "reverted" });
  });

  it("ignores a Trade event emitted by some other contract", async () => {
    const foreign = { ...tradeLog({ quoteAmount: 1n, tokenAmount: 1n, isBuy: true, fee: 0n, launchTax: 0n }), address: WETH };
    const { trade } = setup({ logs: [foreign] });
    await expect(trade.buyWithEth(buyArgs)).rejects.toMatchObject({ code: "no_trade_event" });
  });
});

describe("sell", () => {
  it("calls sellForEth with the minimum payout and reads the payout from the event", async () => {
    const { trade, writeContract } = setup({
      logs: [tradeLog({ quoteAmount: 5_000n, tokenAmount: 10n ** 24n, isBuy: false, fee: 50n, launchTax: 0n })],
    });
    const result = await trade.sell({ token: TOKEN, amount: 10n ** 24n, minQuoteOutput: 4_000n });
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: LAUNCHPAD, functionName: "sellForEth", args: [TOKEN, 10n ** 24n, 4_000n] }),
    );
    expect(writeContract.mock.calls[0]![0]).not.toHaveProperty("value");
    expect(result.quoteAmount).toBe(5_000n);
  });
});

describe("approveIfNeeded", () => {
  it("does nothing when the allowance already covers the amount", async () => {
    const { trade, writeContract } = setup({ allowance: 10n ** 25n });
    await trade.approveIfNeeded({ token: TOKEN, amount: 10n ** 24n });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("approves the maximum by default, to the launchpad, and waits for it to be mined", async () => {
    const { trade, writeContract, waitForTransactionReceipt } = setup({ allowance: 0n });
    await trade.approveIfNeeded({ token: TOKEN, amount: 10n ** 24n });
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: TOKEN, functionName: "approve", args: [LAUNCHPAD, maxUint256] }),
    );
    expect(waitForTransactionReceipt).toHaveBeenCalledOnce();
  });

  it("approves exactly the amount when asked to", async () => {
    const { trade, writeContract } = setup({ allowance: 0n });
    await trade.approveIfNeeded({ token: TOKEN, amount: 10n ** 24n, exact: true });
    expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({ args: [LAUNCHPAD, 10n ** 24n] }));
  });
});

describe("createToken", () => {
  const args = { name: "Name", ticker: "TCK", metadataURI: "ipfs://x", quoteToken: WETH, antiSniperWindow: 60 } as const;

  it("pays the creation fee read from the chain and returns the token from the TokenCreated event", async () => {
    const created = "0x00000000000000000000000000000000000000f6" as Address;
    const { trade, writeContract } = setup({ logs: [createdLog(created)] });
    const result = await trade.createToken(args);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FACTORY,
        functionName: "deployERC20Token",
        args: ["Name", "TCK", "ipfs://x", WETH, 60],
        value: 5_000_000_000_000_000n,
      }),
    );
    expect(result).toEqual({ token: created, hash: HASH });
  });

  it("fails loudly when no TokenCreated event is found", async () => {
    const { trade } = setup({ logs: [] });
    await expect(trade.createToken(args)).rejects.toMatchObject({ code: "no_created_event" });
  });
});

it("TradeError carries its code and the original cause", () => {
  const cause = new Error("x");
  const e = new TradeError("reverted", "msg", { cause });
  expect(e).toBeInstanceOf(Error);
  expect(e.code).toBe("reverted");
  expect(e.cause).toBe(cause);
});
