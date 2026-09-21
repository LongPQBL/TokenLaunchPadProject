import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PairPicker } from "./pair-picker";

describe("PairPicker", () => {
  it("is a labelled group of two choices: the chain's own quote (ETH here) and USDC", () => {
    render(<PairPicker symbol="ETH" />);
    expect(screen.getByRole("radiogroup", { name: "Pool liquidity pair" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "ETH" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /USDC/ })).toBeInTheDocument();
  });

  it("has the chain's quote chosen and nothing to change it to: it is what the token's pool is paired with", () => {
    render(<PairPicker symbol="ETH" />);
    expect(screen.getByRole("radio", { name: "ETH" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "ETH" })).toBeEnabled();
  });

  it("dims USDC and says it is coming soon, and cannot be chosen", () => {
    render(<PairPicker symbol="ETH" />);
    const usdc = screen.getByRole("radio", { name: /USDC/ });
    expect(usdc).toBeDisabled();
    expect(usdc).not.toBeChecked();
    const option = usdc.closest("label")!;
    expect(within(option).getByText("Coming soon")).toBeInTheDocument();
    expect(option).toHaveClass("opacity-40");
    expect(option).toHaveClass("cursor-not-allowed");
  });

  it("highlights the chosen one and only that one", () => {
    render(<PairPicker symbol="ETH" />);
    expect(screen.getByRole("radio", { name: "ETH" }).closest("label")).toHaveClass("border-primary");
    expect(screen.getByRole("radio", { name: /USDC/ }).closest("label")).not.toHaveClass("border-primary");
  });

  it("says the quote of the chain it is given, not always ETH", () => {
    render(<PairPicker symbol="WETH" />);
    expect(screen.getByRole("radio", { name: "WETH" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "ETH" })).toBeNull();
  });

  it("does not show 'Coming soon' beside the chosen one", () => {
    render(<PairPicker symbol="ETH" />);
    expect(within(screen.getByRole("radio", { name: "ETH" }).closest("label")!).queryByText("Coming soon")).toBeNull();
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
  });
});
