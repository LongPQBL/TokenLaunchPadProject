import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";

// A placeholder. The header's "Create token" button has to lead somewhere real, and the create flow is built in the
// next group of work, which replaces this page.
export default async function CreatePage({ params }: { params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();

  return (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p role="status" className="text-muted-foreground">
          {UI.create.soon}
        </p>
      </main>
    </>
  );
}
