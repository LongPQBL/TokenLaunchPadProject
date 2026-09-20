"use client";

import { UI } from "@vezta/shared";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

/** The strip under a profile's header. Only the strip is a client component: each panel is rendered on the server and passed in. */
export function ProfileTabs({ created, holdings }: { created: ReactNode; holdings: ReactNode }) {
  return (
    <Tabs defaultValue="created">
      <TabsList>
        <TabsTrigger value="created">{UI.profile.tabs.created}</TabsTrigger>
        <TabsTrigger value="holdings">{UI.profile.tabs.holdings}</TabsTrigger>
      </TabsList>
      <TabsContent value="created">{created}</TabsContent>
      <TabsContent value="holdings">{holdings}</TabsContent>
    </Tabs>
  );
}
