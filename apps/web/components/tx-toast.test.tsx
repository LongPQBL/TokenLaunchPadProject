import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TxToast } from "./tx-toast";

const HASH = `0x${"ab".repeat(32)}` as const;

describe("TxToast", () => {
  it("shows nothing when idle", () => {
    const { container } = render(<TxToast state={{ status: "idle" }} chain="sepolia" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says it is waiting while a transaction is in flight", () => {
    render(<TxToast state={{ status: "pending" }} chain="sepolia" />);
    expect(screen.getByRole("status")).toHaveTextContent("Confirm in your wallet, then wait for the network…");
  });

  it("reports success with a link to the transaction on the explorer", () => {
    render(<TxToast state={{ status: "success", message: "You bought 1,000 tokens.", hash: HASH }} chain="sepolia" />);
    expect(screen.getByRole("status")).toHaveTextContent("You bought 1,000 tokens.");
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", `https://sepolia.etherscan.io/tx/${HASH}`);
  });

  it("offers no link when the hash is not a real transaction hash", () => {
    render(<TxToast state={{ status: "success", message: "ok", hash: "javascript:alert(1)" as never }} chain="sepolia" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows an error as an alert", () => {
    render(<TxToast state={{ status: "error", message: "Price changed. Increase slippage or try again." }} chain="sepolia" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Price changed");
  });
});
