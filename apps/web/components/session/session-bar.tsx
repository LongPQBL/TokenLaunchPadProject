"use client";

import { UI } from "@vezta/shared";
import type { ReactNode } from "react";
import { useAccount, useBalance } from "wagmi";
import { FundWallet } from "@/components/fund-wallet";
import { QuoteValue } from "@/components/quote-value";
import { Button } from "@/components/ui/button";
import { getDeployment } from "@/lib/deployment";
import { shortAddress } from "@/lib/format";
import { useSession } from "@/lib/session/use-session";
import { useWalletKind } from "@/lib/wallet/wallet-kind";
import { TopUpDialog } from "./top-up-dialog";
import { WithdrawDialog } from "./withdraw-dialog";

function WalletRow({ chain, testId, label, address, balance, spending, children }: { chain: string; testId: string; label: string; address: string; balance: bigint | undefined; spending: boolean; children?: ReactNode }) {
  return (
    <div data-testid={testId} data-spending={spending} className={`flex flex-col gap-1 border p-3 ${spending ? "border-primary" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
        {spending && <span className="text-xs text-primary">{UI.session.tradingWithThis}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-sm">
        <span title={address}>{shortAddress(address)}</span>
        <span>{balance === undefined ? "…" : <QuoteValue chain={chain} raw={balance} digits={6} />}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Which wallet is spending, always in view. The main wallet and the trading wallet are different addresses with
 * different balances: each is shown with its own label, address and balance, never merged, and the one that pays for a
 * trade is marked. With no session, it offers one and says what its one signature does.
 */
export function SessionBar({ chain }: { chain: string }) {
  const { address } = useAccount();
  const session = useSession();
  const kind = useWalletKind();
  const chainId = getDeployment()?.chainId;
  const main = useBalance({ address, chainId, query: { enabled: !!address, refetchInterval: 10_000 } });
  const trading = useBalance({ address: session.account?.address, chainId, query: { enabled: !!session.account, refetchInterval: 10_000 } });

  if (!address) return null;
  // An embedded wallet IS the trading wallet (spec 7.3): it signs by itself, so there is nothing to turn on, top up or withdraw, and
  // one address in all. Whatever the session provider says is not looked at.
  if (kind === "embedded") {
    return (
      <section aria-label={UI.session.yourWallet} className="flex flex-col gap-2">
        <WalletRow chain={chain} testId="main-wallet" label={UI.session.yourWallet} address={address} balance={main.data?.value} spending />
        <FundWallet address={address} balance={main.data?.value} chain={chain} />
      </section>
    );
  }
  const tradingWith = session.status === "ready" && !!session.account;

  return (
    <section aria-label={UI.session.tradingWallet} className="flex flex-col gap-2">
      <WalletRow chain={chain} testId="main-wallet" label={UI.session.mainWallet} address={address} balance={main.data?.value} spending={!tradingWith && session.status === "off"} />

      {session.status === "ready" && session.account && (
        <WalletRow chain={chain} testId="trading-wallet" label={UI.session.tradingWallet} address={session.account.address} balance={trading.data?.value} spending>
          <div className="flex gap-2">
            <TopUpDialog chain={chain} to={session.account.address} mainBalance={main.data?.value} />
            <WithdrawDialog chain={chain} account={session.account} />
          </div>
        </WalletRow>
      )}

      {session.status === "off" && (
        <div className="flex flex-col gap-2 border border-border p-3 text-sm">
          <p className="font-semibold">{UI.session.offTitle}</p>
          <p className="text-xs text-muted-foreground">{UI.session.offBody}</p>
          <Button size="sm" onClick={() => void session.enable()}>
            {UI.session.turnOn}
          </Button>
        </div>
      )}

      {session.status === "needs-signature" && (
        <div role="status" className="flex flex-col gap-2 border border-warning p-3 text-sm">
          <p className="font-semibold">{UI.session.restoreTitle}</p>
          <p className="text-xs text-muted-foreground">{UI.session.restoreBody}</p>
          <Button size="sm" onClick={() => void session.enable()}>
            {UI.session.restore}
          </Button>
        </div>
      )}

      {session.status === "mismatch" && (
        <div role="alert" className="flex flex-col gap-2 border border-destructive p-3 text-sm">
          <p className="font-semibold">{UI.session.mismatchTitle}</p>
          <p className="text-xs text-muted-foreground">{UI.session.mismatchBody}</p>
        </div>
      )}

      {session.status !== "off" && (
        <Button size="xs" variant="ghost" className="self-start" onClick={session.disable}>
          {UI.session.turnOff}
        </Button>
      )}
    </section>
  );
}
