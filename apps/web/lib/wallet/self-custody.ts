import { launchpadAbi, tokenAbi, tokenFactoryAbi } from "@vezta/abi";
import type { Account } from "viem";
import { BaseError, maxUint256, parseEventLogs, UserRejectedRequestError, type Address, type Hash, type PublicClient, type WalletClient } from "viem";
import { TradeError, type CreateTokenArgs, type SignerKind, type TradeResult, type UseTrade } from "./types";

export interface SelfCustodyDeps {
  deployment: { launchpad: Address; factory: Address; weth: Address };
  /** The chain the app is deployed for. A wallet on any other chain is refused before it is asked anything. */
  expectedChainId: number;
  account: Address | undefined;
  chainId: number | undefined;
  walletClient: Pick<WalletClient, "writeContract" | "sendCalls" | "waitForCallsStatus"> | undefined;
  /** Which signer this is. The default is the person's own wallet; the session wallet is this same seam over a local key. */
  kind?: SignerKind;
  /**
   * What is handed to the client as `account` when sending. Defaults to `account`, an address, which the client sends to
   * the wallet to sign (the person's own wallet). For a session wallet it is the LOCAL account object, which signs in
   * the browser: passing just its address would ask the RPC node to sign, and a node has no such key.
   */
  signer?: Address | Account;
  /** True when the wallet said it can run several calls atomically (EIP-5792), so approve + sell can be one prompt. */
  canBatch?: boolean;
  publicClient: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
}

/**
 * Did the person say no in their wallet? EIP-1193 calls that error code 4001, but by the time it reaches here it has been
 * wrapped by viem, by wagmi, by the connector, each with its own error class, and any of them may have dropped the
 * code. So the whole `cause` chain is searched (bounded, and safe against a chain that loops) for either the code or
 * the well-known class name.
 */
export function isUserRejection(e: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = e, depth = 0; current && typeof current === "object" && !seen.has(current) && depth < 8; depth++) {
    seen.add(current);
    const { code, name, cause } = current as { code?: unknown; name?: unknown; cause?: unknown };
    const className = (current as object).constructor?.name;
    if (code === 4001 || code === "ACTION_REJECTED" || name === "UserRejectedRequestError" || className === "UserRejectedRequestError") return true;
    if (current instanceof BaseError && current.walk((x) => x instanceof UserRejectedRequestError)) return true;
    current = cause;
  }
  return false;
}

/**
 * Trading with the person's own wallet: every transaction is signed by them and sent to the contract, and the
 * backend takes no part. The guards run first, so a wallet that is missing, on the wrong chain or given a bound that
 * protects nothing is never asked to sign.
 */
export function createSelfCustody(deps: SelfCustodyDeps): UseTrade {
  const { deployment, publicClient } = deps;

  /** Narrows to a connected wallet on the right chain, or throws the calm, specific reason it is not. */
  function ready(): { account: Address | Account; address: Address; walletClient: NonNullable<SelfCustodyDeps["walletClient"]> } {
    if (!deps.account || !deps.walletClient) throw new TradeError("not_connected", "Connect a wallet first.");
    if (deps.chainId !== deps.expectedChainId) throw new TradeError("wrong_chain", "Switch your wallet to the right network.");
    return { account: deps.signer ?? deps.account, address: deps.account, walletClient: deps.walletClient };
  }

  /** Sends one contract call and waits for it. A rejection becomes user_rejected; a reverted receipt becomes reverted. */
  async function send(call: () => Promise<Hash>) {
    let hash: Hash;
    try {
      hash = await call();
    } catch (e) {
      if (isUserRejection(e)) throw new TradeError("user_rejected", "The request was declined in the wallet.", { cause: e });
      throw e;
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new TradeError("reverted", "The transaction failed on chain.");
    return { hash, receipt };
  }

  function tradeResult(hash: Hash, logs: Parameters<typeof parseEventLogs>[0]["logs"]): TradeResult {
    const trade = parseEventLogs({ abi: launchpadAbi, logs, eventName: "Trade" }).find(
      (l) => l.address.toLowerCase() === deployment.launchpad.toLowerCase(),
    );
    if (!trade) throw new TradeError("no_trade_event", "The transaction confirmed but reported no trade.");
    const { tokenAmount, quoteAmount, fee, launchTax } = trade.args;
    return { hash, tokenAmount, quoteAmount, fee, launchTax };
  }

  return {
    capabilities: {
      kind: deps.kind ?? "self-custody",
      address: deps.account,
      chainId: deps.chainId,
      canBatch: deps.canBatch ?? false,
      // A session wallet signs in the browser: nothing to confirm in a wallet.
      isZeroPrompt: deps.kind === "session" || deps.kind === "embedded",
    },

    async buyWithEth({ token, amount, maxQuoteCost }) {
      const { account, walletClient } = ready();
      // A max of 0 could never fill and one of maxUint256 would let any price through: both are bugs upstream.
      if (amount <= 0n || maxQuoteCost <= 0n || maxQuoteCost === maxUint256) {
        throw new TradeError("bad_amount", "That amount cannot be traded.");
      }
      const { hash, receipt } = await send(() =>
        walletClient.writeContract({
          address: deployment.launchpad,
          abi: launchpadAbi,
          functionName: "buyWithEth",
          args: [token, amount, maxQuoteCost],
          value: maxQuoteCost, // the contract refunds whatever exceeds the real price in the same transaction
          account,
          chain: null,
        }),
      );
      return tradeResult(hash, receipt.logs);
    },

    async sell({ token, amount, minQuoteOutput, exactApproval = false }) {
      const { account, address, walletClient } = ready();
      if (amount <= 0n || minQuoteOutput <= 0n) throw new TradeError("bad_amount", "That amount cannot be traded.");

      if (deps.canBatch) {
        const allowance = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [address, deployment.launchpad] });
        if (allowance < amount) {
          // One prompt, atomic: either both happen or neither does, so a person is never left approved but unsold.
          let id: string;
          try {
            ({ id } = await walletClient.sendCalls({
              account,
              forceAtomic: true,
              calls: [
                { to: token, abi: tokenAbi, functionName: "approve", args: [deployment.launchpad, exactApproval ? amount : maxUint256] },
                { to: deployment.launchpad, abi: launchpadAbi, functionName: "sellForEth", args: [token, amount, minQuoteOutput] },
              ],
            }));
          } catch (e) {
            if (isUserRejection(e)) throw new TradeError("user_rejected", "The request was declined in the wallet.", { cause: e });
            throw e;
          }
          const status = await walletClient.waitForCallsStatus({ id });
          const receipts = status.receipts ?? [];
          if (status.status !== "success" || receipts.length === 0) throw new TradeError("reverted", "The transaction failed on chain.");
          // A batch receipt's logs carry the three fields the event parser reads (address, topics, data), which is all it needs.
          return tradeResult(receipts.at(-1)!.transactionHash, receipts.flatMap((r) => r.logs) as Parameters<typeof tradeResult>[1]);
        }
      }

      const { hash, receipt } = await send(() =>
        walletClient.writeContract({
          address: deployment.launchpad,
          abi: launchpadAbi,
          functionName: "sellForEth",
          args: [token, amount, minQuoteOutput],
          account,
          chain: null,
        }),
      );
      return tradeResult(hash, receipt.logs);
    },

    async approveIfNeeded({ token, amount, exact = false }) {
      const { account, address, walletClient } = ready();
      const allowance = await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "allowance",
        args: [address, deployment.launchpad],
      });
      if (allowance >= amount) return;
      await send(() =>
        walletClient.writeContract({
          address: token,
          abi: tokenAbi,
          functionName: "approve",
          args: [deployment.launchpad, exact ? amount : maxUint256],
          account,
          chain: null,
        }),
      );
    },

    async createToken(args: CreateTokenArgs) {
      const { account, walletClient } = ready();
      // The creation fee is paid in ETH on top of gas; the contract refunds any excess.
      const createFee = await publicClient.readContract({ address: deployment.launchpad, abi: launchpadAbi, functionName: "createFee" });
      const { hash, receipt } = await send(() =>
        walletClient.writeContract({
          address: deployment.factory,
          abi: tokenFactoryAbi,
          functionName: "deployERC20Token",
          args: [args.name, args.ticker, args.metadataURI, args.quoteToken, args.antiSniperWindow],
          value: createFee,
          account,
          chain: null,
        }),
      );
      const created = parseEventLogs({ abi: tokenFactoryAbi, logs: receipt.logs, eventName: "TokenCreated" }).find(
        (l) => l.address.toLowerCase() === deployment.factory.toLowerCase(),
      );
      if (!created) throw new TradeError("no_created_event", "The transaction confirmed but created no token.");
      return { token: created.args.token, hash };
    },
  };
}
