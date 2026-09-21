"use client";

import { UI } from "@vezta/shared";
import { useExportWallet } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useWalletKind } from "@/lib/wallet/wallet-kind";
import { Button } from "./ui/button";

/**
 * Lets someone with an embedded wallet take their key with them. It only asks Privy to open ITS export screen, which assembles
 * the key on Privy's own origin: this page never sees it. Drawn for the embedded wallet only (an external wallet's key was never
 * ours to hand over). Closing Privy's screen is not an error.
 */
export function ExportKeyButton() {
  const { address } = useAccount();
  const kind = useWalletKind();
  const { exportWallet } = useExportWallet();
  if (kind !== "embedded" || !address) return null;
  return (
    <Button variant="ghost" size="xs" title={UI.wallet.exportKeyHint} onClick={() => void exportWallet({ address }).catch(() => undefined)}>
      {UI.wallet.exportKey}
    </Button>
  );
}
