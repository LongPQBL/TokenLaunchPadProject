import { encodeFunctionData, type Abi, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { TradeError } from "./types";

/** The little of an EIP-1193 provider this needs: Privy's embedded wallet is one. */
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const hex = (n: bigint | number) => `0x${n.toString(16)}`;
const notUsed: (...args: never[]) => Promise<never> = async () => {
  throw new TradeError("bad_amount", "Batching is not used with this wallet.");
};

export interface EmbeddedWalletClientDeps {
  provider: Eip1193;
  /** OUR chain client: it decides the nonce, the gas and the fees, and it sends what was signed. */
  publicClient: Pick<PublicClient, "prepareTransactionRequest" | "sendRawTransaction">;
  account: Address | undefined;
  /** The chain the wallet reports being on. */
  chainId: number | undefined;
  /** The chain the app is deployed for: the only one anything is ever signed for. */
  expectedChainId: number;
}

/**
 * Writes to a contract from an embedded wallet without a confirmation screen. The wallet is asked only to SIGN
 * (`eth_signTransaction`); everything around it is ours: we work out the nonce, gas and fees on our own RPC and broadcast the
 * signed transaction ourselves, so the same code works on a fork, a testnet and mainnet, and no local count of nonces can
 * go stale. It is asked in the shape Privy accepts (found in the spike): `type` as the NUMBER 2 and every quantity as a hex
 * string, which is not what viem's own `signTransaction` sends. Nothing is signed for a chain other than the deployment's,
 * nor without an account.
 */
export function createEmbeddedWalletClient(deps: EmbeddedWalletClientDeps) {
  return {
    async writeContract(args: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
    }): Promise<Hash> {
      if (!deps.account) throw new TradeError("not_connected", "Log in first.");
      if (deps.chainId !== deps.expectedChainId) throw new TradeError("wrong_chain", "Switch your wallet to the right network.");

      const data = encodeFunctionData({ abi: args.abi, functionName: args.functionName, args: args.args } as never);
      const tx = (await deps.publicClient.prepareTransactionRequest({
        account: deps.account,
        to: args.address,
        data,
        value: args.value,
        type: "eip1559",
      } as never)) as unknown as { nonce: number; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

      const signed = (await deps.provider.request({
        method: "eth_signTransaction",
        params: [
          {
            from: deps.account,
            to: args.address,
            data,
            value: hex(args.value ?? 0n),
            nonce: hex(tx.nonce),
            gas: hex(tx.gas),
            maxFeePerGas: hex(tx.maxFeePerGas),
            maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas),
            chainId: hex(deps.expectedChainId),
            type: 2,
          },
        ],
      })) as Hex;
      return deps.publicClient.sendRawTransaction({ serializedTransaction: signed });
    },
    sendCalls: notUsed,
    waitForCallsStatus: notUsed,
  };
}
