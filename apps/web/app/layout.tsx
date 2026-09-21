import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

// A CSP nonce has to be new for every request (proxy.ts), so no page may be built ahead of time: a prerendered page has no
// nonce and its scripts would be blocked.
export const dynamic = "force-dynamic";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
// Every number in the product is set in this face, so digits line up in columns and prices are comparable at a glance.
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Vezta Launchpad",
  description: "Launch and trade tokens on a bonding curve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
