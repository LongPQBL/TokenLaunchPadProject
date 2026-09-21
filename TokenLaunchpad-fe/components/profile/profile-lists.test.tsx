import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TokenListItem } from "@/lib/types";
import { CreatedTab } from "./created-tab";
import { HoldingsTab } from "./holdings-tab";

const token = (n: number, o: Partial<TokenListItem> = {}): TokenListItem => ({
  address: `0x${n.toString(16).padStart(40, "0")}`,
  creator: "0x00000000000000000000000000000000000000a1",
  name: `Token ${n}`,
  ticker: `T${n}`,
  progressBps: 100,
  volumeQuote: 1n,
  tradeCount: 1,
  complete: false,
  migrated: false,
  createdAt: 1_700_000_000n,
  ...o,
});

describe("CreatedTab", () => {
  it("says nothing was created, rather than showing an empty box, for an address that never launched anything", () => {
    render(<CreatedTab chain="sepolia" tokens={[]} />);
    expect(screen.getByText("Nothing created yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("token-card")).toBeNull();
  });

  it("lists each token as a card, in the order given", () => {
    render(<CreatedTab chain="sepolia" tokens={[token(2), token(1)]} />);
    const cards = screen.getAllByTestId("token-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Token 2");
    expect(cards[0]).toHaveAttribute("href", "/sepolia/token/0x0000000000000000000000000000000000000002");
  });

  it("draws a name that is markup as text", () => {
    render(<CreatedTab chain="sepolia" tokens={[token(1, { name: "<img src=x onerror=alert(1)>" })]} />);
    expect(document.querySelector("img[onerror]")).toBeNull();
  });
});

describe("HoldingsTab", () => {
  it("says nothing is held for an address that holds nothing", () => {
    render(<HoldingsTab chain="sepolia" holdings={[]} />);
    expect(screen.getByText("Nothing held yet.")).toBeInTheDocument();
  });

  it("shows each holding with its balance and ticker, biggest first as given", () => {
    render(
      <HoldingsTab
        chain="sepolia"
        holdings={[
          { token: token(2), amount: 5_000_000n * 10n ** 18n },
          { token: token(1), amount: 12n * 10n ** 18n },
        ]}
      />,
    );
    const rows = screen.getAllByTestId("holding-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByTestId("holding-balance")).toHaveTextContent("5M T2");
    expect(within(rows[1]!).getByTestId("holding-balance")).toHaveTextContent("12 T1");
    expect(within(rows[0]!).getByTestId("token-card")).toHaveTextContent("Token 2");
  });

  it("falls back to the address for a token with no ticker, and never prints a hostile ticker as markup", () => {
    render(<HoldingsTab chain="sepolia" holdings={[{ token: token(1, { ticker: "<b>x</b>" }), amount: 10n ** 18n }]} />);
    expect(screen.getByTestId("holding-balance")).toHaveTextContent("<b>x</b>");
    expect(document.querySelector("b")).toBeNull();
  });
});
