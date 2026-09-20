"use client";

import { chainBySlug, UI } from "@vezta/shared";
import Link from "next/link";
import { useAccount } from "wagmi";
import { explorerAddressUrl } from "@/lib/explorer";
import { useSession } from "@/lib/session/use-session";

/**
 * The address this profile is about, in full. To its owner, and only to its owner, it also names the trading wallet when one
 * exists (spec 7.4): what a person holds may be in either, and the trading wallet has a profile of its own to look at.
 */
export function ProfileAddresses({ chain, address }: { chain: string; address: string }) {
  const { address: viewer } = useAccount();
  const { account } = useSession();
  const explorer = explorerAddressUrl(chainBySlug(chain), address);
  const owner = !!viewer && viewer.toLowerCase() === address.toLowerCase();
  const trading = owner ? account?.address : undefined;

  return (
    <dl className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-2">
        {trading && <dt>{UI.profile.mainWallet}</dt>}
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
      {trading && (
        <div className="flex flex-wrap gap-2">
          <dt>{UI.profile.sessionWallet}</dt>
          <dd className="break-all">
            <Link href={`/${chain}/profile/${trading}`} className="hover:text-foreground hover:underline">
              {trading}
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}
