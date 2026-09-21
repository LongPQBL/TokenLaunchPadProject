import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Health } from "@/lib/types";
import { HealthPanel } from "./health-panel";

const NOW = 1_700_003_600;
const health = (o: Partial<Health> = {}): Health => ({
  indexerLagBlocks: 0,
  watcherAliveSince: 1_700_000_000n,
  botAddress: "0x00000000000000000000000000000000000000b1",
  botBalance: 1_500_000_000_000_000_000n,
  failedMetadataCount: 0,
  stuckTokens: [],
  ...o,
});
const show = (o: Partial<Health> = {}, onRetry = vi.fn().mockResolvedValue({ count: 0 })) => {
  render(<HealthPanel health={health(o)} now={NOW} decimals={18} symbol="ETH" onRetryMetadata={onRetry} />);
  return onRetry;
};
const row = (label: string) => screen.getByText(label).closest("[data-testid='health-row']") as HTMLElement;

describe("HealthPanel", () => {
  it("says the indexer is in sync at zero and how many blocks behind otherwise", () => {
    show({ indexerLagBlocks: 0 });
    expect(row("Indexer")).toHaveTextContent("In sync");
  });

  it("counts blocks behind, in the singular too", () => {
    show({ indexerLagBlocks: 1 });
    expect(row("Indexer")).toHaveTextContent("1 block behind");
  });

  it("says unknown, never in sync, when the lag could not be read", () => {
    show({ indexerLagBlocks: null });
    expect(row("Indexer")).toHaveTextContent("Unknown");
    expect(row("Indexer")).not.toHaveTextContent("In sync");
  });

  it("says since when the watcher has run, and that it is not running when there is no heartbeat", () => {
    show();
    expect(row("Watcher")).toHaveTextContent("Running, started 1h ago");
  });

  it("says the watcher is not running when it has not spoken", () => {
    show({ watcherAliveSince: null });
    expect(row("Watcher")).toHaveTextContent("Not running");
  });

  it("shows the bot wallet and its balance in ETH, exactly, from wei", () => {
    show();
    expect(row("Bot wallet")).toHaveTextContent("0x0000…00b1");
    expect(row("Bot wallet")).toHaveTextContent("1.5 ETH");
  });

  it("says the balance is unknown when it is, and does not call it zero", () => {
    show({ botBalance: null });
    expect(row("Bot wallet")).toHaveTextContent("Unknown");
    expect(row("Bot wallet")).not.toHaveTextContent("0 ETH");
  });

  it("shows a real zero balance as zero: an empty bot wallet is what an operator most needs to see", () => {
    show({ botBalance: 0n });
    expect(row("Bot wallet")).toHaveTextContent("0 ETH");
  });

  it("offers no retry when no metadata has failed", () => {
    show({ failedMetadataCount: 0 });
    expect(row("Failed metadata")).toHaveTextContent("None");
    expect(screen.queryByRole("button", { name: "Retry all" })).toBeNull();
  });

  it("counts failed metadata and retries them all on request, saying how many were moved", async () => {
    const onRetry = show({ failedMetadataCount: 3 }, vi.fn().mockResolvedValue({ count: 3 }));
    expect(row("Failed metadata")).toHaveTextContent("3");
    await userEvent.click(screen.getByRole("button", { name: "Retry all" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("3 tokens will be resolved again.")).toBeInTheDocument();
  });

  it("says so when the retry fails, and lets it be tried again", async () => {
    show({ failedMetadataCount: 3 }, vi.fn().mockRejectedValue(new Error("boom")));
    await userEvent.click(screen.getByRole("button", { name: "Retry all" }));
    expect(await within(row("Failed metadata")).findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.getByRole("button", { name: "Retry all" })).toBeEnabled();
  });
});
