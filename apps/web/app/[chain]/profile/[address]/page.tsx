import { chainBySlug, neutraliseBidi, UI } from "@vezta/shared";
import { notFound } from "next/navigation";
import { CreatedTab } from "@/components/profile/created-tab";
import { ClaimFees } from "@/components/profile/claim-fees";
import { EditProfile } from "@/components/profile/edit-profile";
import { HoldingsTab } from "@/components/profile/holdings-tab";
import { ProfileAddresses } from "@/components/profile/profile-addresses";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { SiteHeader } from "@/components/site-header";
import { TokenImage } from "@/components/token-image";
import { api } from "@/lib/api";
import { isAddress, shortAddress } from "@/lib/format";

/**
 * Anyone's profile: what an address launched and what it holds. An address that has never touched the launchpad is an empty
 * profile, not an error. The name and picture, if there are any, are the person's own words and are drawn as text and as a
 * checked image. The claim button draws nothing unless the viewer is this address and the chain says there is something to claim.
 */
export default async function ProfilePage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  const config = chainBySlug(chain);
  if (!config) notFound();

  const shell = (body: React.ReactNode) => (
    <>
      <SiteHeader chain={chain} sort="new" q="" isTestnet={config.isTestnet} />
      <main className="mx-auto max-w-4xl px-4 py-6">{body}</main>
    </>
  );

  if (!isAddress(address)) {
    return shell(
      <p role="alert" className="py-16 text-center text-muted-foreground">
        {UI.errors.pageNotFound}
      </p>,
    );
  }
  const owner = address.toLowerCase();

  let profile;
  try {
    profile = await api.profile(chain, owner);
  } catch (error) {
    console.error("profile page: could not load the profile", error);
    return shell(
      <p role="alert" className="py-16 text-center text-muted-foreground">
        {UI.profile.loadFailed}
      </p>,
    );
  }

  const name = profile.user?.username ? neutraliseBidi(profile.user.username) : shortAddress(owner);
  return shell(
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <TokenImage
          src={profile.user?.avatarUrl}
          alt=""
          initial={name.replace(/^0x/, "") || "?"}
          className="size-16 rounded-full text-xl"
        />
        <div className="min-w-0">
          <h1 className="break-all text-2xl font-semibold">{name}</h1>
          <ProfileAddresses chain={chain} address={owner} />
        </div>
        <div className="ml-auto">
          <EditProfile address={owner} current={profile.user ?? {}} />
        </div>
      </header>
      <ClaimFees chain={chain} address={owner} />
      <ProfileTabs
        created={<CreatedTab chain={chain} tokens={profile.created} />}
        holdings={<HoldingsTab chain={chain} holdings={profile.holdings} />}
      />
    </div>,
  );
}
