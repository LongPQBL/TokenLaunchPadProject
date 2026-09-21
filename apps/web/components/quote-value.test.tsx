import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT } from "@/test/wallet";
import { PriceValue, QuoteValue } from "./quote-value";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT));
afterEach(() => vi.unstubAllEnvs());

const ETH = 10n ** 18n;
const priced = () => fakeChain({ usd: { answer: 3_000n * 10n ** 8n } });
const show = (ui: React.ReactElement, chain = priced()) => renderWithWallet(ui, undefined, chain.transport);

describe("QuoteValue", () => {
  it("shows ETH until the price of ETH is known, then dollars", async () => {
    show(<QuoteValue chain="sepolia" raw={ETH / 100n} />);
    expect(screen.getByText("0.01 ETH")).toBeInTheDocument();
    expect(await screen.findByText("$30.00")).toBeInTheDocument();
    expect(screen.queryByText("0.01 ETH")).toBeNull();
  });

  it("shows ETH, and no dollar at all, when there is no price", async () => {
    show(<QuoteValue chain="sepolia" raw={ETH / 100n} />, fakeChain());
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByText("0.01 ETH")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("writes a big amount compactly when asked", async () => {
    show(<QuoteValue chain="sepolia" raw={ETH * 1_000n} compact />);
    expect(await screen.findByText("$3M")).toBeInTheDocument();
  });

  it("puts the ETH it comes to underneath when asked, and in the tooltip always", async () => {
    show(<QuoteValue chain="sepolia" raw={ETH / 100n} secondary />);
    const dollars = await screen.findByText("$30.00");
    expect(screen.getByText("0.01 ETH")).toBeInTheDocument();
    expect(dollars.closest("[title]")).toHaveAttribute("title", "0.01 ETH");
  });

  it("gives the ETH in the tooltip even without the second line", async () => {
    show(<QuoteValue chain="sepolia" raw={ETH / 100n} />);
    const dollars = await screen.findByText("$30.00");
    expect(dollars.closest("[title]")).toHaveAttribute("title", "0.01 ETH");
    expect(screen.queryByText("0.01 ETH")).toBeNull();
  });

  it("shows a gain with a plus and a loss with a minus, in dollars or in ETH", async () => {
    const { unmount } = show(<QuoteValue chain="sepolia" raw={ETH / 100n} signed />);
    expect(await screen.findByText("+$30.00")).toBeInTheDocument();
    unmount();
    show(<QuoteValue chain="sepolia" raw={-ETH / 100n} signed />, fakeChain());
    await waitFor(() => expect(screen.getByText("-0.01 ETH")).toBeInTheDocument());
  });

  it("says less than a cent for something too small to be one, and $0.00 for nothing", async () => {
    const { unmount } = show(<QuoteValue chain="sepolia" raw={1_000_000n} />);
    expect(await screen.findByText("<$0.01")).toBeInTheDocument();
    unmount();
    show(<QuoteValue chain="sepolia" raw={0n} />);
    expect(await screen.findByText("$0.00")).toBeInTheDocument();
  });
});

describe("without a wallet layer around it", () => {
  it("still draws, in ETH, rather than failing: there is no chain to ask for a price", () => {
    render(
      <>
        <QuoteValue chain="sepolia" raw={ETH / 100n} />
        <PriceValue chain="sepolia" raw={15_625_000n} />
      </>,
    );
    expect(screen.getByText("0.01 ETH")).toBeInTheDocument();
    expect(screen.getByText("0.000000000015625 ETH")).toBeInTheDocument();
  });
});

describe("PriceValue", () => {
  it("shows a token's price in ETH until the price of ETH is known, then in dollars", async () => {
    show(<PriceValue chain="sepolia" raw={15_625_000n} />);
    expect(screen.getByText("0.000000000015625 ETH")).toBeInTheDocument();
    expect(await screen.findByText("$0.000000046875")).toBeInTheDocument();
  });

  it("puts the price in ETH underneath when asked", async () => {
    show(<PriceValue chain="sepolia" raw={15_625_000n} secondary />);
    expect(await screen.findByText("$0.000000046875")).toBeInTheDocument();
    expect(screen.getByText("0.000000000015625 ETH")).toBeInTheDocument();
  });

  it("shows ETH only when there is no price", async () => {
    show(<PriceValue chain="sepolia" raw={15_625_000n} />, fakeChain());
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByText("0.000000000015625 ETH")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
