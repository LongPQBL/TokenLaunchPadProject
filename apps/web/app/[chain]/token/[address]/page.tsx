import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { GraduationProgress } from "@/components/graduation-progress";
import { SiteHeader } from "@/components/site-header";
import { TokenHeader } from "@/components/token-header";
import { api, ApiError } from "@/lib/api";
import { isAddress } from "@/lib/format";

export default async function TokenPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();

  const shell = (body: React.ReactNode) => (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-6xl px-4 py-6">{body}</main>
    </>
  );

  // The address comes from the URL. Anything that is not an address is "not found" without asking the API.
  if (!isAddress(address)) return shell(<NotFound />);

  let token;
  try {
    token = await api.token(chain, address.toLowerCase());
  } catch (error) {
    // A missing or hidden token is a plain "not found". Anything else is logged for the operator and shown calmly.
    if (error instanceof ApiError && error.status === 404) return shell(<NotFound />);
    console.error("token page: could not load the token", error);
    return shell(
      <p role="alert" className="py-16 text-center text-muted-foreground">
        {UI.errors.loadFailed}
      </p>,
    );
  }

  return shell(
    <div className="flex flex-col gap-6">
      <TokenHeader chain={chain} token={token} />
      <GraduationProgress token={token} decimals={config.quoteDecimals} symbol={config.quoteSymbol} />
    </div>,
  );
}

function NotFound() {
  return (
    <p role="alert" className="py-16 text-center text-muted-foreground">
      {UI.errors.notFound}
    </p>
  );
}
