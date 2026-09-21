"use client";

import { UI } from "@vezta/shared";
import type { ReactNode } from "react";
import { useBalance } from "wagmi";
import { FundWallet } from "@/components/fund-wallet";
import { QuoteValue } from "@/components/quote-value";
import { getDeployment } from "@/lib/deployment";
import { shortAddress } from "@/lib/format";
import { useSession } from "@/lib/session/use-session";
import { useIdentity } from "@/lib/wallet/use-identity";
import { TradingWalletNotice } from "@/components/trading-wallet-notice";
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
 * The wallet that trades, always in view. An external wallet's trading wallet is who trades and who the person is here, with its own
 * address and balance and the way to fill it (Top up, from the main wallet) and to empty it (Withdraw all, to the main wallet); the main
 * wallet behind it is shown as what it is, never merged with it. There is nothing to turn on: it opens by itself when the wallet
 * connects, and this says so while it does, and how to open it if the one signature it needs was declined. A wallet that signs by
 * itself (Google, email) is its own trading wallet: one address, nothing to top up or withdraw.
 */
export function SessionBar({ chain }: { chain: string }) {
  const identity = useIdentity();
  const session = useSession();
  const chainId = getDeployment()?.chainId;
  const main = useBalance({ address: identity.main, chainId, query: { enabled: !!identity.main, refetchInterval: 10_000 } });
  const trading = useBalance({ address: session.account?.address, chainId, query: { enabled: !!session.account, refetchInterval: 10_000 } });

  if (identity.kind === "none" || !identity.main) return null;
  // An embedded wallet IS the trading wallet (spec 7.3): it signs by itself, so there is nothing to top up or withdraw, and one
  // address in all. Whatever the session provider says is not looked at.
  if (identity.kind === "embedded") {
    return (
      <section aria-label={UI.session.yourWallet} className="flex flex-col gap-2">
        <WalletRow chain={chain} testId="main-wallet" label={UI.session.yourWallet} address={identity.main} balance={main.data?.value} spending />
        <FundWallet address={identity.main} balance={main.data?.value} chain={chain} />
      </section>
    );
  }

  return (
    <section aria-label={UI.session.tradingWallet} className="flex flex-col gap-2">
      {identity.status === "ready" && session.account && (
        <WalletRow chain={chain} testId="trading-wallet" label={UI.session.tradingWallet} address={session.account.address} balance={trading.data?.value} spending>
          <div className="flex gap-2">
            <TopUpDialog chain={chain} to={session.account.address} mainBalance={main.data?.value} />
            <WithdrawDialog chain={chain} account={session.account} />
          </div>
        </WalletRow>
      )}

      <TradingWalletNotice />

      <WalletRow chain={chain} testId="main-wallet" label={UI.session.mainWallet} address={identity.main} balance={main.data?.value} spending={false} />
    </section>
  );
}
