import { buildMetadata, tokenFormSchema } from "./metadata.ts";

const ok = tokenFormSchema.safeParse({ name: "Demo Token", ticker: "demo", antiSniperWindow: 60, website: "https://example.com" });
if (!ok.success) throw new Error("valid form rejected");
console.log(buildMetadata(ok.data, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"));

const bad = [
  { name: "", ticker: "DEMO" },
  { name: "x".repeat(33), ticker: "DEMO" },
  { name: "Demo", ticker: "D" },
  { name: "Demo", ticker: "DE MO" },
  { name: "Demo", ticker: "DEMO", antiSniperWindow: 30 },
  { name: "Demo", ticker: "DEMO", website: "javascript:alert(1)" },
];
for (const b of bad) if (tokenFormSchema.safeParse(b).success) throw new Error(`should reject ${JSON.stringify(b)}`);
console.log(`OK: valid form accepted, ${bad.length} invalid forms rejected`);
