import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TokenListItem } from "@/lib/types";
import { TokenCard } from "./token-card";

const base: TokenListItem = {
  address: "0x8509aea46cef52be7cc3d07b3f2a4c4f08ae7744",
  creator: "0xc0ffee0000000000000000000000000000000000",
  name: "Demo Token",
  ticker: "DEMO",
  description: "About the token",
  imageUrl: "https://cdn.example/x.png",
  progressBps: 7800,
  volumeQuote: 1_500_000_000_000_000_000n,
  tradeCount: 12,
  complete: false,
  migrated: false,
  createdAt: 1_700_000_000n,
};
const card = (o: Partial<TokenListItem> = {}) => render(<TokenCard chain="sepolia" token={{ ...base, ...o }} />);

describe("TokenCard: what it shows", () => {
  it("links to the token page under the chain", () => {
    card();
    expect(screen.getByTestId("token-card")).toHaveAttribute("href", `/sepolia/token/${base.address}`);
  });

  it("shows name, ticker, description, progress, volume and trade count", () => {
    card();
    expect(screen.getByText("Demo Token")).toBeInTheDocument();
    expect(screen.getByText("DEMO")).toBeInTheDocument();
    expect(screen.getByText("About the token")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "78");
    expect(screen.getByText(/1\.5 ETH/)).toBeInTheDocument();
    expect(screen.getByText(/12 trades/)).toBeInTheDocument();
  });

  it("renders the image with the token name as its alt text", () => {
    card();
    expect(screen.getByRole("img", { name: "Demo Token" })).toHaveAttribute("src", "https://cdn.example/x.png");
  });

  it("marks a token that is filling its last steps and one that has graduated", () => {
    card({ complete: true, migrated: false });
    expect(screen.getByText("GRADUATING…")).toBeInTheDocument();
  });

  it("marks a graduated token", () => {
    card({ complete: true, migrated: true });
    expect(screen.getByText("GRADUATED")).toBeInTheDocument();
  });

  it("shows nothing about graduation while the curve is still trading", () => {
    card();
    expect(screen.queryByText(/GRADUAT/)).not.toBeInTheDocument();
  });

  it("clamps a progress value past 100% so the bar cannot overflow its box", () => {
    card({ progressBps: 12000 });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

// Review Focus 1: a token whose metadata never resolved must still appear, with what the chain says.
describe("TokenCard: a token with no metadata", () => {
  it("uses its on-chain name and a placeholder instead of an image", () => {
    card({ imageUrl: undefined, description: undefined, name: "Fresh", ticker: "FRSH" });
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByTestId("token-image-placeholder")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("falls back to a shortened address when the token has no name at all", () => {
    card({ imageUrl: undefined, name: undefined, ticker: undefined });
    expect(screen.getByText("0x8509…7744")).toBeInTheDocument();
  });

  it("does not crash on a token with no description", () => {
    card({ description: undefined });
    expect(screen.getByTestId("token-card")).toBeInTheDocument();
  });
});

// Review Focus 4: name, ticker, description and image URL are all written by strangers.
describe("TokenCard: hostile text and images", () => {
  it("renders a name containing markup as literal text, never as elements", () => {
    card({ name: "<img src=x onerror=alert(1)>", imageUrl: undefined });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("does the same for the ticker and the description", () => {
    card({ ticker: "<b>X</b>", description: "<script>alert(1)</script>" });
    expect(screen.getByText("<b>X</b>")).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });

  it("refuses an image URL that is not http(s), showing the placeholder instead", () => {
    for (const imageUrl of ["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>", "file:///etc/passwd"]) {
      const { unmount } = card({ imageUrl });
      expect(screen.queryByRole("img"), imageUrl).not.toBeInTheDocument();
      expect(screen.getByTestId("token-image-placeholder"), imageUrl).toBeInTheDocument();
      unmount();
    }
  });

  it("does not send the visitor's address to the image host as a referrer", () => {
    card();
    expect(screen.getByRole("img")).toHaveAttribute("referrerpolicy", "no-referrer");
  });
});
