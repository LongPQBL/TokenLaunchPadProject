"use client";

import type { Address } from "viem";
import { UI } from "@vezta/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BuyPanel } from "./buy-panel";
import { CurveGate } from "./curve-state";
import { LastTradeProvider } from "./last-trade";
import { SellPanel } from "./sell-panel";

/**
 * Buy and sell for one token. Whether the curve is still filling, waiting to migrate or already on Uniswap is decided
 * once, by the gate, so neither panel has to.
 */
export function TradePanel({ chain, token, ticker }: { chain: string; token: Address; ticker: string }) {
  return (
    <LastTradeProvider>
      <CurveGate chain={chain} token={token}>
        <Tabs defaultValue="buy">
          <TabsList className="w-full">
            <TabsTrigger value="buy">{UI.trade.buy}</TabsTrigger>
            <TabsTrigger value="sell">{UI.trade.sell}</TabsTrigger>
          </TabsList>
          <TabsContent value="buy">
            <BuyPanel chain={chain} token={token} ticker={ticker} />
          </TabsContent>
          <TabsContent value="sell">
            <SellPanel chain={chain} token={token} ticker={ticker} />
          </TabsContent>
        </Tabs>
      </CurveGate>
    </LastTradeProvider>
  );
}
