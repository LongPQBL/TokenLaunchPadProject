import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { shortAddress } from "@/lib/format";
import type { TokenDetail } from "@/lib/types";
import { GraduationProgress } from "./graduation-progress";
import { StatusBadge } from "./status-badge";
import { TokenHeader } from "./token-header";

// The reserves of a real token part-way along its curve, read from a launchpad on a local Sepolia fork.
const detail: TokenDetail = {
  address: "0x8509aea46cef52be7cc3d07b3f2a4c4f08ae7744",
  creator: "0xc0ffee0000000000000000000000000000000000",
  name: "Demo Token",
  ticker: "DEMO",
  description: "About the token",
  imageUrl: "https://cdn.example/x.png",
  progressBps: 4500,
  volumeQuote: 1n,
  tradeCount: 3,
  complete: false,
  migrated: false,
  createdAt: 1_700_000_000n,
  quoteToken: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
  antiSniperWindow: 60,
  virtualQuoteReserves: 21_902_806_297_056_811n,
  virtualTokenReserves: 811_666_666_666_666_666_666_666_666n,
  pair: undefined,
  metadataStatus: "ok",
  socials: { website: "https://example.com", twitter: "https://x.com/demo" },
};
const header = (o: Partial<TokenDetail> = {}) => render(<TokenHeader chain="sepolia" token={{ ...detail, ...o }} />);

describe("StatusBadge", () => {
  it("says TRADING while the curve is filling", () => {
    render(<StatusBadge complete={false} migrated={false} />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("TRADING");
  });

  it("says GRADUATING… once the curve is full and the pool is not yet made", () => {
    render(<StatusBadge complete migrated={false} />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("GRADUATING…");
  });

  it("says GRADUATED once the token has moved to Uniswap", () => {
    render(<StatusBadge complete migrated />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("GRADUATED");
  });

  it("treats migrated as graduated even if the complete flag has not arrived", () => {
    render(<StatusBadge complete={false} migrated />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("GRADUATED");
  });
});

describe("GraduationProgress", () => {
  it("shows how much has been collected against the graduation target, worked out from the reserves", () => {
    render(<GraduationProgress token={detail} decimals={18} symbol="ETH" />);
    expect(screen.getByText("0.0052 / 0.05 ETH collected")).toBeInTheDocument();
  });

  // The reserves of a real token that has graduated, read from the running stack. Its derived target is one wei SHORT
  // of 0.05 ETH, which truncating would print as 0.0499: found by running everything together, so it stays as a test.
  it("shows a graduated token's round target as itself, not one wei short", () => {
    const graduated = { ...detail, complete: true, migrated: true, progressBps: 10000, virtualQuoteReserves: 66_666_666_666_666_665n, virtualTokenReserves: 266_666_666_666_666_666_666_666_666n };
    render(<GraduationProgress token={graduated} decimals={18} symbol="ETH" />);
    expect(screen.getByText("0.05 / 0.05 ETH collected")).toBeInTheDocument();
  });

  it("draws the bar from the indexer's progress", () => {
    render(<GraduationProgress token={detail} decimals={18} symbol="ETH" />);
    const bar = screen.getByRole("progressbar", { name: "Graduation progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("does not show an overfull bar for a value past 100%", () => {
    render(<GraduationProgress token={{ ...detail, progressBps: 15000 }} decimals={18} symbol="ETH" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("shows nothing collected rather than a broken figure when there are no reserves", () => {
    render(<GraduationProgress token={{ ...detail, virtualQuoteReserves: 0n, virtualTokenReserves: 0n }} decimals={18} symbol="ETH" />);
    expect(screen.getByText("0 / 0 ETH collected")).toBeInTheDocument();
  });
});

describe("TokenHeader: identity", () => {
  it("shows the whole contract address as a link to the block explorer", () => {
    header();
    const link = screen.getByRole("link", { name: detail.address });
    expect(link).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${detail.address}`);
    // The link leaves the site: it must not hand the explorer a handle back to this page.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the creator, shortened, as an explorer link", () => {
    header();
    const link = screen.getByRole("link", { name: shortAddress(detail.creator) });
    expect(link).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${detail.creator}`);
  });

  it("shows the price in the chain's currency", () => {
    header();
    expect(screen.getByText("0.000000000026985 ETH")).toBeInTheDocument();
  });

  it("shows the status badge", () => {
    header({ complete: true, migrated: false });
    expect(screen.getByTestId("status-badge")).toHaveTextContent("GRADUATING…");
  });
});

describe("TokenHeader: Uniswap", () => {
  it("offers Trade on Uniswap, for this token on this chain, once the token has graduated", () => {
    header({ complete: true, migrated: true, pair: "0x01a58f5e9280cd79132f4997d663194dae891979" });
    const link = screen.getByRole("link", { name: "Trade on Uniswap" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin).toBe("https://app.uniswap.org");
    expect(url.searchParams.get("chain")).toBe("sepolia");
    expect(url.searchParams.get("outputCurrency")).toBe(detail.address);
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("does not offer it while the token is still on the curve", () => {
    header();
    expect(screen.queryByRole("link", { name: "Trade on Uniswap" })).not.toBeInTheDocument();
  });

  it("does not offer it while graduating: there is no pool to trade in yet", () => {
    header({ complete: true, migrated: false });
    expect(screen.queryByRole("link", { name: "Trade on Uniswap" })).not.toBeInTheDocument();
  });
});

describe("TokenHeader: metadata that came from a stranger", () => {
  it("renders name, ticker and description as literal text", () => {
    header({ name: "<img src=x onerror=alert(1)>", ticker: "<b>X</b>", description: "<script>alert(1)</script>", imageUrl: undefined });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(screen.getByText("<b>X</b>")).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });

  it("links only the http(s) social links, opening them safely", () => {
    header();
    for (const name of ["Website", "Twitter"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toMatch(/noopener/);
      expect(link.getAttribute("rel")).toMatch(/nofollow/);
    }
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://example.com");
  });

  it("draws each social link as a small icon next to the logo, one for each platform given", () => {
    header({ socials: { website: "https://example.com", twitter: "https://x.com/demo", telegram: "https://t.me/demo" } });
    const identity = screen.getByTestId("token-identity");
    for (const name of ["Website", "Twitter", "Telegram"]) {
      const link = within(identity).getByRole("link", { name });
      expect(link.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("shows no social icons at all when the token gave none", () => {
    header({ socials: {} });
    const identity = screen.getByTestId("token-identity");
    expect(within(identity).queryAllByRole("link")).toHaveLength(0);
  });

  // The API and the resolver both filter these; it is checked again here because this is where an href is written.
  it("does not render a link whose scheme is not http(s)", () => {
    header({ socials: { website: "javascript:alert(1)", twitter: "data:text/html,<script>alert(1)</script>", telegram: "https://t.me/demo" } });
    expect(screen.queryByRole("link", { name: "Website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Twitter" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Telegram" })).toBeInTheDocument();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
  });

  it("ignores a social key it does not know", () => {
    header({ socials: { website: "https://example.com", evil: "https://evil.example" } });
    expect(screen.queryByRole("link", { name: /evil/i })).not.toBeInTheDocument();
  });

  it("uses a placeholder for an image URL that is not http(s)", () => {
    header({ imageUrl: "javascript:alert(1)" });
    expect(screen.getByTestId("token-image-placeholder")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("still shows a token whose metadata is invalid, with what the chain says", () => {
    header({ metadataStatus: "invalid", imageUrl: undefined, description: undefined, socials: {}, name: "Chain Name" });
    expect(screen.getByText("Chain Name")).toBeInTheDocument();
    expect(screen.getByTestId("token-image-placeholder")).toBeInTheDocument();
  });
});
