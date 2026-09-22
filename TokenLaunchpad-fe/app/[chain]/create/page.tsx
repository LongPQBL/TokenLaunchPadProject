import { chainBySlug, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { CreateForm } from "@/components/create/create-form";
import { SiteHeader } from "@/components/site-header";

export default async function CreatePage({ params }: { params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();

  return (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-4 text-2xl font-semibold">{UI.create.title}</h1>
        <CreateForm chain={chain} />
      </main>
    </>
  );
}
