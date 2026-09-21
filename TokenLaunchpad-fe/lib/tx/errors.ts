import { UI } from "@vezta/shared";
import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from "viem";
import { isUserRejection } from "../wallet/self-custody";
import { TradeError } from "../wallet/types";

/** The name of the custom error a contract call reverted with, e.g. "SlippageExceeded"; undefined when it was not a revert. */
export function errorName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName;
  }
  return undefined;
}

export interface FriendlyError {
  code: string;
  message: string;
  /** True for a person saying no in their wallet: nothing to show, and certainly nothing red. */
  silent: boolean;
}

const has = (record: object, key: string) => Object.hasOwn(record, key);

/**
 * Anything a trade can throw -> one calm sentence. The raw revert name, the wallet's message and any stack stay out of
 * the UI: an error message can carry paths, SQL or another party's text. Unmapped errors, and the reference's
 * internal and admin ones, all become the same generic line.
 */
export function friendlyError(e: unknown): FriendlyError {
  if (isUserRejection(e) || (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError))) {
    return { code: "user_rejected", message: "", silent: true };
  }
  if (e instanceof TradeError) {
    if (e.code === "user_rejected") return { code: "user_rejected", message: "", silent: true };
    if (has(UI.tx.seam, e.code)) return { code: e.code, message: UI.tx.seam[e.code as keyof typeof UI.tx.seam], silent: false };
  }

  const name = errorName(e);
  if (name && has(UI.tx.contract, name)) return { code: name, message: UI.tx.contract[name as keyof typeof UI.tx.contract], silent: false };

  const text = e instanceof Error ? e.message : "";
  if ((e instanceof BaseError && e.walk((x) => x instanceof InsufficientFundsError)) || /insufficient funds|out of gas/i.test(text)) {
    return { code: "insufficient_funds", message: UI.tx.needGas, silent: false };
  }
  return { code: "unknown", message: UI.tx.generic, silent: false };
}
