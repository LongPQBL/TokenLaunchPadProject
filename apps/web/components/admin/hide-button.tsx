"use client";

import { UI } from "@vezta/shared";
import { useRouter } from "next/navigation";
import { useSiwe } from "@/lib/auth/use-siwe";
import { getModerationApi } from "@/lib/moderation/client";
import { ConfirmAction } from "./confirm-action";

/**
 * Hides the token this page is about, for everyone. Drawn only for a signed-in admin: for anyone else the component renders
 * nothing at all, so there is no button in the page to find. That is a courtesy; the API refuses a non-admin's request on its
 * own. Afterwards the page leaves, because a token that is now hidden must not stay on screen.
 */
export function HideTokenButton({ chain, token }: { chain: string; token: string }) {
  const { isAdmin } = useSiwe();
  const router = useRouter();
  if (!isAdmin) return null;
  return (
    <ConfirmAction
      label={UI.moderation.hideToken}
      title={UI.moderation.hideTokenTitle}
      body={UI.moderation.hideTokenBody}
      run={() => getModerationApi().hideToken(chain, token.toLowerCase())}
      onDone={() => {
        router.push(`/${chain}`);
        router.refresh();
      }}
    />
  );
}

/** Hides one comment, for everyone, and tells the list so it can drop it without a reload. Admins only, as above. */
export function HideCommentButton({ chain, id, onHidden }: { chain: string; id: string; onHidden: (id: string) => void }) {
  const { isAdmin } = useSiwe();
  if (!isAdmin) return null;
  return (
    <ConfirmAction
      variant="ghost"
      label={UI.moderation.hideComment}
      title={UI.moderation.hideCommentTitle}
      body={UI.moderation.hideCommentBody}
      run={() => getModerationApi().hideComment(chain, id)}
      onDone={() => onHidden(id)}
    />
  );
}
