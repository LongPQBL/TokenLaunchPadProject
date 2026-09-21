"use client";

import { useBalance } from "wagmi";
import { getDeployment } from "@/lib/deployment";
import { useIdentity } from "@/lib/wallet/use-identity";
import { ReceiveDialog } from "./receive-dialog";
import { TopUpDialog } from "./session/top-up-dialog";

/**
 * Deposit, in the header: puts ETH into the wallet the person trades from. For an external wallet that is a transfer from the main
 * wallet into its trading wallet (one confirmation); for a wallet that signs by itself it shows the address to send ETH to. Drawn only
 * once there is a trading wallet to deposit to: not with no wallet connected, and not while the trading wallet is still opening.
 */
export function DepositButton({ chain }: { chain: string }) {
  const identity = useIdentity();
  const main = useBalance({ address: identity.main, chainId: getDeployment()?.chainId, query: { enabled: identity.kind === "external", refetchInterval: 10_000 } });
  // The identity has an address only once the trading wallet is open, so this is also "not while it is still opening".
  if (!identity.address) return null;
  if (identity.kind === "external") return <TopUpDialog chain={chain} to={identity.address} mainBalance={main.data?.value} trigger={{ size: "sm", variant: "default" }} />;
  return <ReceiveDialog chain={chain} address={identity.address} />;
}
