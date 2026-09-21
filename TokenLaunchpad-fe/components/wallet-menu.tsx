"use client";

import { chainBySlug, UI } from "@vezta/shared";
import { useBalance } from "wagmi";
import { getDeployment } from "@/lib/deployment";
import { shortAddress } from "@/lib/format";
import { useSession } from "@/lib/session/use-session";
import { useIdentity } from "@/lib/wallet/use-identity";
import { CopyButton } from "./copy-button";
import { QuoteValue } from "./quote-value";
import { WithdrawDialog } from "./session/withdraw-dialog";
import { TradingWalletNotice } from "./trading-wallet-notice";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{children}</span>
    </div>
  );
}

/**
 * The wallet the person trades from, in the header: its balance and short address as one button, and behind it everything about the
 * wallet: the whole address to copy, the balance, the main wallet it is funded from, and the way to empty it into that (Withdraw all).
 * `address` is who the person is (the trading wallet once it is open, the connected wallet until then).
 */
export function WalletMenu({ chain, address }: { chain: string; address: string }) {
  const identity = useIdentity();
  const session = useSession();
  const chainId = getDeployment()?.chainId;
  const external = identity.kind === "external";
  const own = useBalance({ address: address as `0x${string}`, chainId, query: { refetchInterval: 10_000 } });
  const main = useBalance({ address: identity.main, chainId, query: { enabled: external, refetchInterval: 10_000 } });
  const explorer = chainBySlug(chain)?.explorerUrl;
  const ready = identity.status === "ready";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={UI.session.menuLabel} className="gap-2">
          {ready && own.data && <QuoteValue chain={chain} raw={own.data.value} digits={4} className="font-mono text-xs" />}
          <span className="font-mono text-xs">{shortAddress(address)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-3">
        {ready ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide">{external ? UI.session.tradingWallet : UI.session.yourWallet}</p>
            <p className="break-all font-mono text-xs" aria-label={UI.session.menuAddress}>
              {address}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <CopyButton text={address} />
              {explorer && (
                <a href={`${explorer}/address/${address}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                  {UI.session.viewOnExplorer}
                </a>
              )}
            </div>
            <Line label={UI.session.balance}>{own.data ? <QuoteValue chain={chain} raw={own.data.value} digits={6} /> : "…"}</Line>
            {external && identity.main && (
              <>
                <div className="border-t border-border pt-3">
                  <Line label={UI.session.mainWallet}>
                    <span title={identity.main}>{shortAddress(identity.main)}</span>
                  </Line>
                  <div className="mt-1 flex justify-end font-mono text-xs">{main.data ? <QuoteValue chain={chain} raw={main.data.value} digits={6} /> : "…"}</div>
                </div>
                {session.account && <WithdrawDialog chain={chain} account={session.account} />}
              </>
            )}
          </>
        ) : (
          <TradingWalletNotice />
        )}
      </PopoverContent>
    </Popover>
  );
}
