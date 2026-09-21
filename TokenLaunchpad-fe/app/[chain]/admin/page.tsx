import { chainBySlug } from "@vezta/shared";
import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/admin/admin-panel";
import { SiteHeader } from "@/components/site-header";

/**
 * The page itself is public HTML with nothing in it: everything is fetched from the API, which answers only an admin, by the
 * panel, which draws a plain "not found" for anyone else. So there is nothing here to protect, and nothing to find.
 */
export default async function AdminPage({ params }: { params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();

  return (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <AdminPanel chain={chain} />
      </main>
    </>
  );
}
