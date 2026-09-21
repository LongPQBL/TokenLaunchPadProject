import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FundWallet } from "./fund-wallet";

// Mixed case, as wallets show it: a copy that lower-cased it would not be the address the person sees.
const ADDRESS = "0x52908400098527886E0F7030069857D2E4169EE7";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_FAUCET_URL", "https://faucet.example/sepolia"));
afterEach(() => vi.unstubAllEnvs());

describe("FundWallet", () => {
  it("draws nothing while the balance is not known: an unread balance is not an empty one", () => {
    const { container } = render(<FundWallet address={ADDRESS} balance={undefined} chain="sepolia" />);
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing for a wallet that holds any ETH at all", () => {
    for (const balance of [1n, 10n ** 18n]) {
      const { container, unmount } = render(<FundWallet address={ADDRESS} balance={balance} chain="sepolia" />);
      expect(container.innerHTML, String(balance)).toBe("");
      unmount();
    }
  });

  // Review Focus 5: a new user with no ETH is told what to do, not shown a dead button.
  it("at exactly zero shows the whole address, says to send ETH to it, and links the faucet", () => {
    render(<FundWallet address={ADDRESS} balance={0n} chain="sepolia" />);
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByText(/holds no ETH/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /faucet/i });
    expect(link).toHaveAttribute("href", "https://faucet.example/sepolia");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("still says what to do when no faucet is configured, without a link", () => {
    vi.stubEnv("NEXT_PUBLIC_FAUCET_URL", "");
    render(<FundWallet address={ADDRESS} balance={0n} chain="sepolia" />);
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never links a faucet address that is not http(s): a javascript: URL is dropped", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x", "faucet.example"]) {
      vi.stubEnv("NEXT_PUBLIC_FAUCET_URL", bad);
      const { unmount } = render(<FundWallet address={ADDRESS} balance={0n} chain="sepolia" />);
      expect(screen.queryByRole("link"), bad).toBeNull();
      unmount();
    }
  });

  it("copies exactly the address, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<FundWallet address={ADDRESS} balance={0n} chain="sepolia" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });

  it("does not fail when the browser will not copy", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    render(<FundWallet address={ADDRESS} balance={0n} chain="sepolia" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });
});
