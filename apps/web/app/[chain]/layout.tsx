import { chainBySlug } from "@vezta/shared";
import { notFound } from "next/navigation";
import { WalletProvider } from "@/lib/wallet/provider";

// The chain is the first segment of every URL. An unknown one is a 404 here, once, so no page below has to check.
// The wallet layer sits here too, so the header's connect button and every trading panel share one connection.
export default async function ChainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  if (!chainBySlug(chain)) notFound();
  return <WalletProvider>{children}</WalletProvider>;
}
