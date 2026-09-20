import { BaseError, ContractFunctionRevertedError } from "viem";

/** The name of the custom error a contract call reverted with, e.g. "SlippageExceeded"; undefined when it was not a revert. */
export function errorName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName;
  }
  return undefined;
}
