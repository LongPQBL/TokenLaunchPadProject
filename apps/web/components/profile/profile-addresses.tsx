"use client";

import { chainBySlug, UI } from "@vezta/shared";
import { explorerAddressUrl } from "@/lib/explorer";
import { useIdentity } from "@/lib/wallet/use-identity";

/**
 * The address this profile is about, in full. To its owner, and only to its owner, it also names the main wallet the trading wallet is
 * funded from (an external wallet: the profile is the TRADING wallet's, which is who the person is here). Someone else's profile shows
 * the one address and nothing about who is looking.
 */
export function ProfileAddresses({ chain, address }: { chain: string; address: string }) {
  const { address: me, main, kind } = useIdentity();
  const explorer = explorerAddressUrl(chainBySlug(chain), address);
  const owner = !!me && me.toLowerCase() === address.toLowerCase();
  // A wallet that signs by itself has one address; an external wallet has its trading wallet (this one) and the main wallet behind it.
  const funding = owner && kind === "external" ? main : undefined;

  return (
    <dl className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-2">
        {funding && <dt>{UI.profile.sessionWallet}</dt>}
        <dd className="break-all">
          {explorer ? (
            <a href={explorer} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
              {address}
            </a>
          ) : (
            address
          )}
        </dd>
      </div>
      {funding && (
        <div className="flex flex-wrap gap-2">
          <dt>{UI.profile.mainWallet}</dt>
          <dd className="break-all">{funding}</dd>
        </div>
      )}
    </dl>
  );
}
