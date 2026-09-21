"use client";

import { useRouter } from "next/navigation";
import type { LiveClient } from "@/lib/ws/client";
import { liveTokenHiddenSchema } from "@/lib/ws/moderation";
import { useLiveRoom } from "@/lib/ws/use-live-room";

/**
 * On a token's page: when a moderator hides THIS token while it is open, load the page again. The server now answers 404 for
 * it, so the visitor is shown that it is gone instead of a trade feed and thread that quietly stop loading. Draws nothing.
 */
export function TokenHiddenWatcher({ chain, token, client }: { chain: string; token: string; client?: LiveClient }) {
  const router = useRouter();
  const wanted = token.toLowerCase();
  useLiveRoom({
    room: `token:${chain}:${wanted}`,
    client,
    poll: false, // it only listens: the other listeners of this room refetch the data
    refetch: async () => {},
    onMessage: (message) => {
      const parsed = liveTokenHiddenSchema.safeParse(message);
      if (parsed.success && parsed.data.chain === chain && parsed.data.token === wanted) router.refresh();
    },
  });
  return null;
}
