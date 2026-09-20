"use client";

import { UI } from "@vezta/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const EVERY_MS = 3_000;
const GIVE_UP_AFTER = 40; // about two minutes

/**
 * A token has just been created and the indexer has not seen it yet, which takes a few seconds. This says so and asks
 * the server-rendered page to load again until it is there. It does not retry for ever: after two minutes it admits the
 * token was not found.
 */
export function IndexingNotice() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      router.refresh();
      if (tries >= GIVE_UP_AFTER) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);

  return gaveUp ? (
    <p role="alert" className="py-16 text-center text-muted-foreground">
      {UI.errors.notFound}
    </p>
  ) : (
    <p role="status" className="py-16 text-center text-muted-foreground">
      {UI.errors.indexing}
    </p>
  );
}
