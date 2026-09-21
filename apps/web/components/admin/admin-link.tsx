"use client";

import { UI } from "@vezta/shared";
import Link from "next/link";
import { useSiwe } from "@/lib/auth/use-siwe";
import { Button } from "../ui/button";

/**
 * A way into the admin page for someone who is one. It is drawn only for a signed-in admin (the API says who that is, in the
 * session), so nobody else is shown that the page exists. It only decides whether to draw: the API decides who may act.
 */
export function AdminLink({ chain }: { chain: string }) {
  const { isAdmin } = useSiwe();
  if (!isAdmin) return null;
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link href={`/${chain}/admin`}>{UI.nav.admin}</Link>
    </Button>
  );
}
