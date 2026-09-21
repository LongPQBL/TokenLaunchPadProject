import { chainBySlug } from "@vezta/shared";
import { notFound } from "next/navigation";
import { SideNav } from "@/components/side-nav";
import { WalletProvider } from "@/lib/wallet/provider";

// The chain is the first segment of every URL. An unknown one is a 404 here, once, so no page below has to check.
// The wallet layer sits here too, so the header's connect button, the side nav and every trading panel share one connection.
export default async function ChainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  if (!chainBySlug(chain)) notFound();
  return (
    <WalletProvider>
      <SideNav chain={chain} />
      {/* Room for the nav: a rail's width on the left when there is one, a bar's height at the bottom when there is not. */}
      <div className="pb-16 lg:pb-0 lg:pl-14">{children}</div>
    </WalletProvider>
  );
}
