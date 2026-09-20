import { launchpadAbi, tokenAbi, tokenFactoryAbi } from "@vezta/abi";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, InsufficientFundsError, UserRejectedRequestError, type Abi } from "viem";
import { describe, expect, it } from "vitest";
import { TradeError } from "../wallet/types";
import { errorName, friendlyError } from "./errors";

/** What viem throws for a call that reverted with the named custom error, wrapped the way writeContract wraps it. */
function revert(abi: Abi, name: string, args: unknown[] = []) {
  const data = encodeErrorResult({ abi, errorName: name, args } as never);
  const inner = new ContractFunctionRevertedError({ abi, data, functionName: "buyWithEth" });
  return new BaseError("Execution reverted", { cause: inner });
}

const GENERIC = "Something went wrong. Please try again.";
const ADDR = "0x00000000000000000000000000000000000000a1";

// One row per entry of the contract reference's error table (docs/02-contract-reference.md).
const USER_FACING: [string, Abi, unknown[], string][] = [
  ["AlreadyMigrated", launchpadAbi, [], "Already on Uniswap."],
  ["BondingCurveNotSet", tokenFactoryAbi, [], "Service not ready."],
  ["CurveCompleted", launchpadAbi, [], "This token has finished its bonding curve and is moving to Uniswap."],
  ["CurveNotFound", launchpadAbi, [], "Unknown token."],
  ["ERC20InsufficientAllowance", tokenAbi, [ADDR, 0n, 1n], "Approve the token first."],
  ["ERC20InsufficientBalance", tokenAbi, [ADDR, 0n, 1n], "Insufficient token balance."],
  ["EthTransferFailed", launchpadAbi, [], "ETH transfer failed. Use a wallet that accepts ETH."],
  ["InsufficientValue", launchpadAbi, [], "Not enough ETH sent."],
  ["InvalidAntiSniperWindow", launchpadAbi, [], "Pick one of the allowed windows."],
  ["NotCompleted", launchpadAbi, [], "Not ready to migrate yet."],
  ["NothingToClaim", launchpadAbi, [], "Nothing to claim."],
  ["PairMismatch", launchpadAbi, [], "Migration failed, contact support."],
  ["QuoteNotEnabled", launchpadAbi, [], "This currency is not supported."],
  ["QuoteNotWeth", launchpadAbi, [], "Use the token payment flow for this token."],
  ["QuoteTransferMismatch", launchpadAbi, [], "This currency cannot be used."],
  ["SafeERC20FailedOperation", launchpadAbi, [ADDR], "Token transfer failed."],
  ["SlippageExceeded", launchpadAbi, [], "Price changed. Increase slippage or try again."],
  ["TransferToPairLocked", tokenAbi, [], "Transfers to the pool are locked until the token graduates."],
  ["ZeroAmount", launchpadAbi, [], "Enter an amount."],
];

// The table marks these "(internal)" or "(admin)": a person can never usefully act on them, so they get the generic message.
const INTERNAL: [string, Abi, unknown[]][] = [
  ["CurveExists", launchpadAbi, []],
  ["EthNotAccepted", launchpadAbi, []],
  ["ERC20InvalidApprover", tokenAbi, [ADDR]],
  ["ERC20InvalidReceiver", tokenAbi, [ADDR]],
  ["ERC20InvalidSender", tokenAbi, [ADDR]],
  ["ERC20InvalidSpender", tokenAbi, [ADDR]],
  ["FeeTooHigh", launchpadAbi, []],
  ["GraduationTooLarge", launchpadAbi, []],
  ["GraduationTooSmall", launchpadAbi, []],
  ["NotBondingCurve", tokenAbi, []],
  ["NotFactory", launchpadAbi, []],
  ["OwnableInvalidOwner", launchpadAbi, [ADDR]],
  ["OwnableUnauthorizedAccount", launchpadAbi, [ADDR]],
  ["PairAlreadySet", tokenAbi, []],
  ["QuoteSupplyTooLarge", launchpadAbi, []],
  ["ReentrancyGuardReentrantCall", launchpadAbi, []],
  ["RenounceDisabled", launchpadAbi, []],
  ["ZeroAddress", launchpadAbi, []],
];

describe("friendlyError: contract errors", () => {
  it.each(USER_FACING)("%s says what the reference suggests, and is worth showing", (name, abi, args, message) => {
    expect(friendlyError(revert(abi, name, args))).toEqual({ code: name, message, silent: false });
  });

  it.each(INTERNAL)("%s is internal or admin: generic message, never the raw name", (name, abi, args) => {
    const result = friendlyError(revert(abi, name, args));
    expect(result.message).toBe(GENERIC);
    expect(result.message).not.toContain(name);
    expect(result.silent).toBe(false);
  });
});

describe("friendlyError: everything else", () => {
  it("treats a person declining in the wallet as silent, not an error to show", () => {
    expect(friendlyError(new UserRejectedRequestError(new Error("no")))).toMatchObject({ code: "user_rejected", silent: true });
    expect(friendlyError(new TradeError("user_rejected", "declined"))).toMatchObject({ code: "user_rejected", silent: true });
  });

  it("says a wallet with too little ETH needs more for network fees", () => {
    const need = "You need more ETH for network fees.";
    expect(friendlyError(new InsufficientFundsError({ cause: new BaseError("x") })).message).toBe(need);
    expect(friendlyError(new Error("intrinsic gas too low: out of gas")).message).toBe(need);
    expect(friendlyError(new Error("insufficient funds for gas * price + value")).message).toBe(need);
  });

  it("explains the seam's own failures calmly", () => {
    expect(friendlyError(new TradeError("wrong_chain", "x")).message).toBe("Switch your wallet to the right network.");
    expect(friendlyError(new TradeError("not_connected", "x")).message).toBe("Connect a wallet first.");
    expect(friendlyError(new TradeError("reverted", "x")).message).toBe("The transaction failed on chain.");
    expect(friendlyError(new TradeError("bad_amount", "x")).message).toBe("Enter an amount.");
    expect(friendlyError(new TradeError("not_configured", "x")).message).toBe("Trading is not configured for this deployment.");
  });

  it("falls back to a generic message and never leaks a raw revert string or a stack", () => {
    const result = friendlyError(new Error("execution reverted: internal secret path /srv/db"));
    expect(result).toEqual({ code: "unknown", message: GENERIC, silent: false });
    expect(friendlyError("a bare string").message).toBe(GENERIC);
    expect(friendlyError(undefined).message).toBe(GENERIC);
  });
});

describe("errorName", () => {
  it("finds the revert name inside the wrappers viem adds", () => {
    expect(errorName(revert(launchpadAbi, "SlippageExceeded"))).toBe("SlippageExceeded");
  });

  it("is undefined when it was not a contract revert", () => {
    expect(errorName(new Error("x"))).toBeUndefined();
  });
});
