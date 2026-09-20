import { launchpadAbi, tokenAbi, tokenFactoryAbi } from "@vezta/abi";
import { BaseError, maxUint256, parseEventLogs, UserRejectedRequestError, type Address, type Hash, type PublicClient, type WalletClient } from "viem";
import { TradeError, type CreateTokenArgs, type TradeResult, type UseTrade } from "./types";

export interface SelfCustodyDeps {
  deployment: { launchpad: Address; factory: Address; weth: Address };
  /** The chain the app is deployed for. A wallet on any other chain is refused before it is asked anything. */
  expectedChainId: number;
  account: Address | undefined;
  chainId: number | undefined;
  walletClient: Pick<WalletClient, "writeContract"> | undefined;
  publicClient: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
}

/** EIP-1193 says a person declining is error code 4001; viem wraps it, and some wallets throw it bare. */
export function isUserRejection(e: unknown): boolean {
  if (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError)) return true;
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === 4001;
}

/**
 * Trading with the person's own wallet: every transaction is signed by them and sent to the contract, and the
 * backend takes no part. The guards run first, so a wallet that is missing, on the wrong chain or given a bound that
 * protects nothing is never asked to sign.
 */
export function createSelfCustody(deps: SelfCustodyDeps): UseTrade {
  const { deployment, publicClient } = deps;

  /** Narrows to a connected wallet on the right chain, or throws the calm, specific reason it is not. */
  function ready(): { account: Address; walletClient: Pick<WalletClient, "writeContract"> } {
    if (!deps.account || !deps.walletClient) throw new TradeError("not_connected", "Connect a wallet first.");
    if (deps.chainId !== deps.expectedChainId) throw new TradeError("wrong_chain", "Switch your wallet to the right network.");
    return { account: deps.account, walletClient: deps.walletClient };
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
    capabilities: { kind: "self-custody", address: deps.account, chainId: deps.chainId, canBatch: false, isZeroPrompt: false },

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

    async sell({ token, amount, minQuoteOutput }) {
      const { account, walletClient } = ready();
      if (amount <= 0n || minQuoteOutput <= 0n) throw new TradeError("bad_amount", "That amount cannot be traded.");
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
      const { account, walletClient } = ready();
      const allowance = await publicClient.readContract({
        address: token,
        abi: tokenAbi,
        functionName: "allowance",
        args: [account, deployment.launchpad],
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
