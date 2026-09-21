"use client";

import { chainBySlug, formatQuote, UI } from "@vezta/shared";
import { usePublicClient } from "wagmi";
import { useCreatorFees } from "@/lib/chain/use-creator-fees";
import { getDeployment } from "@/lib/deployment";
import { claimCreatorFees } from "@/lib/profile/claim";
import { useTxRun } from "@/lib/tx/use-tx-run";
import { useIdentity } from "@/lib/wallet/use-identity";
import { useSigner } from "@/lib/wallet/use-signer";
import { ChainGuard } from "../chain-guard";
import { Button } from "../ui/button";

/**
 * Lets a creator collect what their tokens have earned. Drawn only for the owner of the address being looked at, and only when
 * the chain says there is something to claim: an amount not yet read, or zero, draws nothing at all. (Anyone could send the
 * transaction and the creator would still be the one paid; showing the button to others would only suggest otherwise.)
 */
export function ClaimFees({ chain, address }: { chain: string; address: string }) {
  const { address: viewer } = useIdentity();
  const signer = useSigner();
  const publicClient = usePublicClient();
  const { fees, refetch } = useCreatorFees(address as `0x${string}`);
  const { state, run } = useTxRun();
  const deployment = getDeployment();
  const config = chainBySlug(chain);

  const owner = !!viewer && viewer.toLowerCase() === address.toLowerCase();
  if (!owner || !deployment || !publicClient || fees === undefined || fees === 0n) return null;

  return (
    <section aria-label={UI.profile.fees.title} className="flex flex-wrap items-center gap-3 border border-border px-4 py-3 text-sm">
      <p>{UI.profile.fees.available(formatQuote(fees, config?.quoteDecimals ?? 18, 6), config?.quoteSymbol ?? "ETH")}</p>
      <ChainGuard chainName={config?.name ?? chain}>
        <Button
          size="sm"
          disabled={state.status === "pending"}
          onClick={() =>
            void run(
              () =>
                claimCreatorFees(
                  {
                    launchpad: deployment.launchpad,
                    quote: deployment.weth,
                    expectedChainId: deployment.chainId,
                    chainId: signer.chainId,
                    account: signer.account,
                    localAccount: signer.localAccount,
                    walletClient: signer.walletClient,
                    publicClient,
                  },
                  address as `0x${string}`,
                ),
              ({ hash }) => {
                void refetch();
                return { message: UI.profile.fees.claimed, hash };
              },
            )
          }
        >
          {state.status === "pending" ? UI.profile.fees.claiming : UI.profile.fees.claim}
        </Button>
      </ChainGuard>
      {state.status === "success" && (
        <span role="status" className="text-muted-foreground">
          {state.message}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="text-destructive">
          {state.message}
        </span>
      )}
    </section>
  );
}
