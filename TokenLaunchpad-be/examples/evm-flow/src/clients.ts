import { createPublicClient, createTestClient, createWalletClient, http, type Account, type Chain, type Transport, type WalletClient } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { chainFor, loadDeployment } from "./config.ts";

// The default mnemonic is the public anvil/hardhat one: fine for a local fork, NEVER for a real network.
const MNEMONIC = process.env.MNEMONIC ?? "test test test test test test test test test test test junk";

export function makeContext() {
  const deployment = loadDeployment();
  const chain = chainFor(deployment);
  const transport = http(chain.rpcUrls.default.http[0]);
  return {
    deployment,
    chain,
    publicClient: createPublicClient({ chain, transport }),
    /** The i-th account of the mnemonic. Only use it as the funder on a local fork (see randomWallet). */
    wallet: (i: number) =>
      createWalletClient({ account: mnemonicToAccount(MNEMONIC, { addressIndex: i }), chain, transport }),
    /**
     * A fresh random wallet. Use these for demo users: the well-known dev keys are swept by bots on public
     * networks (EIP-7702 delegations), and a fork inherits that code, so any ETH sent to them, including the
     * refund from a launchpad call, vanishes. In a browser this is the user's connected wallet.
     */
    randomWallet: () =>
      createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain, transport }),
    /** Only works against anvil/hardhat: lets the demo skip time (the launch tax depends on it). */
    testClient: createTestClient({ chain, transport, mode: "anvil" }),
  };
}

export type Ctx = ReturnType<typeof makeContext>;
/** Any wallet that can sign: a browser wallet (wagmi), a random key, or a mnemonic account. */
export type Wallet = WalletClient<Transport, Chain, Account>;
