"use client";

import { UI } from "@vezta/shared";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

/**
 * The strip under the chart. Only the tab strip is a client component: each panel is rendered on the server and
 * passed in, so the tables (and their "2s ago" times) are computed once, in one place, and cannot mismatch on hydration.
 */
export function TokenTabs({ trades, holders, comments }: { trades: ReactNode; holders: ReactNode; comments: ReactNode }) {
  return (
    <Tabs defaultValue="trades">
      <TabsList>
        <TabsTrigger value="trades">{UI.token.tabs.trades}</TabsTrigger>
        <TabsTrigger value="holders">{UI.token.tabs.holders}</TabsTrigger>
        <TabsTrigger value="comments">{UI.token.tabs.comments}</TabsTrigger>
      </TabsList>
      <TabsContent value="trades">{trades}</TabsContent>
      <TabsContent value="holders">{holders}</TabsContent>
      <TabsContent value="comments">{comments}</TabsContent>
    </Tabs>
  );
}
