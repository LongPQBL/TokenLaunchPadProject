import { CHAINS } from "@vezta/shared";
import { redirect } from "next/navigation";

// The chain is part of every URL (/sepolia/...), so the bare root goes to the first configured chain.
export default function Home() {
  redirect(`/${Object.keys(CHAINS)[0]}`);
}
