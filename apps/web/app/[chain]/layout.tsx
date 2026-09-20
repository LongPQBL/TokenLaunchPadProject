import { chainBySlug } from "@vezta/shared";
import { notFound } from "next/navigation";

// The chain is the first segment of every URL. An unknown one is a 404 here, once, so no page below has to check.
export default async function ChainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  if (!chainBySlug(chain)) notFound();
  return <>{children}</>;
}
