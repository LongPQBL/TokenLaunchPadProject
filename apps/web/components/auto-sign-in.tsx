"use client";

import { useAutoSiwe } from "@/lib/auth/use-auto-siwe";

/** Signs the person in to the API by themselves once their wallet is open (see useAutoSiwe). Mounted once, for the whole app. Draws nothing. */
export function AutoSignIn() {
  useAutoSiwe();
  return null;
}
