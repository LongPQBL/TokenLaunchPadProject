import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TokenListItem } from "@/lib/types";
import { renderWithWallet } from "@/test/wallet";
import { SearchBox } from "./search-box";
import { SiteHeader } from "./site-header";
import { SortTabs } from "./sort-tabs";
import { TokenGrid } from "./token-grid";

const token = (n: number): TokenListItem => ({
  address: `0x${n.toString(16).padStart(40, "0")}`,
  creator: "0xc0ffee0000000000000000000000000000000000",
  name: `Token ${n}`,
  ticker: `T${n}`,
  progressBps: 100,
  volumeQuote: 1n,
  tradeCount: 1,
  complete: false,
  migrated: false,
  createdAt: 1n,
});

describe("TokenGrid", () => {
  it("renders one card per token", () => {
    render(<TokenGrid chain="sepolia" items={[token(1), token(2), token(3)]} sort="new" q="" />);
    expect(screen.getAllByTestId("token-card")).toHaveLength(3);
  });

  it("shows the empty state, not a spinner, when there are no tokens", () => {
    render(<TokenGrid chain="sepolia" items={[]} sort="new" q="" />);
    expect(screen.getByText("No tokens yet. Be the first to create one.")).toBeInTheDocument();
  });

  it("shows a different empty state when a search matched nothing", () => {
    render(<TokenGrid chain="sepolia" items={[]} sort="new" q="zzz" />);
    expect(screen.getByText("No tokens match that search.")).toBeInTheDocument();
    expect(screen.queryByText(/Be the first/)).not.toBeInTheDocument();
  });

  it("links to the next page, keeping the sort and the search, only when there is one", () => {
    const { rerender } = render(<TokenGrid chain="sepolia" items={[token(1)]} sort="volume" q="dog" />);
    expect(screen.queryByRole("link", { name: /next/i })).not.toBeInTheDocument();
    rerender(<TokenGrid chain="sepolia" items={[token(1)]} sort="volume" q="dog" nextCursor="c1" />);
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute("href", "/sepolia?sort=volume&q=dog&cursor=c1&view=grid"); // the grid stays a grid on the next page
  });
});

describe("keeping the view", () => {
  it("SortTabs keeps the grid in every link, and leaves the table (the default) out", () => {
    const { unmount } = render(<SortTabs chain="sepolia" active="new" q="dog" view="grid" />);
    expect(screen.getAllByRole("link").map((t) => t.getAttribute("href"))).toEqual(["/sepolia?q=dog&view=grid", "/sepolia?sort=volume&q=dog&view=grid", "/sepolia?sort=progress&q=dog&view=grid"]);
    unmount();
    render(<SortTabs chain="sepolia" active="new" q="dog" view="table" />);
    expect(screen.getAllByRole("link").map((t) => t.getAttribute("href"))).toEqual(["/sepolia?q=dog", "/sepolia?sort=volume&q=dog", "/sepolia?sort=progress&q=dog"]);
  });

  it("SearchBox carries the grid along, and adds nothing for the table", () => {
    const { container, unmount } = render(<SearchBox chain="sepolia" sort="new" q="" view="grid" />);
    expect(container.querySelector("input[type=hidden][name=view]")).toHaveValue("grid");
    unmount();
    const table = render(<SearchBox chain="sepolia" sort="new" q="" view="table" />);
    expect(table.container.querySelector("input[name=view]")).toBeNull();
  });

  it("the grid's next-page link stays in the grid", () => {
    render(<TokenGrid chain="sepolia" items={[token(1)]} sort="new" q="" nextCursor="c1" />);
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute("href", "/sepolia?cursor=c1&view=grid");
  });
});

describe("SortTabs", () => {
  it("offers the three sorts as links, so switching needs no script", () => {
    render(<SortTabs chain="sepolia" active="new" q="" />);
    const tabs = screen.getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(["New", "Trending", "Nearing graduation"]);
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual(["/sepolia", "/sepolia?sort=volume", "/sepolia?sort=progress"]);
  });

  it("marks the active sort", () => {
    render(<SortTabs chain="sepolia" active="volume" q="" />);
    expect(screen.getByRole("link", { name: "Trending" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "New" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the search when the sort changes", () => {
    render(<SortTabs chain="sepolia" active="new" q="dog" />);
    expect(screen.getByRole("link", { name: "Trending" })).toHaveAttribute("href", "/sepolia?sort=volume&q=dog");
  });
});

describe("SearchBox", () => {
  it("is a plain GET form to the chain's page, so it works without script", () => {
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/sepolia");
  });

  it("shows the current search and keeps the current sort", () => {
    const { container } = render(<SearchBox chain="sepolia" sort="volume" q="dog" />);
    expect(screen.getByPlaceholderText("Search tokens")).toHaveValue("dog");
    expect(container.querySelector("input[type=hidden][name=sort]")).toHaveValue("volume");
  });

  it("does not add a sort to the URL when the sort is the default", () => {
    const { container } = render(<SearchBox chain="sepolia" sort="new" q="" />);
    expect(container.querySelector("input[name=sort]")).toBeNull();
  });

  it("bounds what can be typed", () => {
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    expect(screen.getByPlaceholderText("Search tokens")).toHaveAttribute("maxlength", "64");
  });
});

describe("SiteHeader", () => {
  it("labels a testnet so nobody mistakes it for real money", () => {
    // The header holds the wallet button, which needs the wallet layer around it.
    renderWithWallet(<SiteHeader chain="sepolia" sort="new" q="" isTestnet />);
    expect(screen.getByText("SEPOLIA TESTNET")).toBeInTheDocument();
  });

  it("does not show the testnet badge on a real network", () => {
    renderWithWallet(<SiteHeader chain="mainnet" sort="new" q="" isTestnet={false} />);
    expect(screen.queryByText(/TESTNET/)).not.toBeInTheDocument();
  });

  it("has a link home, and leaves Create token and Admin to the side nav", () => {
    renderWithWallet(<SiteHeader chain="sepolia" sort="new" q="" isTestnet />);
    expect(screen.queryByRole("link", { name: "Create token" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: /vezta/i })).toHaveAttribute("href", "/sepolia");
  });

  it("includes the search box", () => {
    renderWithWallet(<SiteHeader chain="sepolia" sort="new" q="dog" isTestnet />);
    expect(screen.getByPlaceholderText("Search tokens")).toHaveValue("dog");
  });
});
