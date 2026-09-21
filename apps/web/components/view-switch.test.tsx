import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewSwitch } from "./view-switch";

describe("ViewSwitch", () => {
  it("offers the table and the grid as links, so switching needs no script", () => {
    render(<ViewSwitch chain="sepolia" view="table" sort="new" q="" />);
    expect(screen.getByRole("link", { name: "Table" })).toHaveAttribute("href", "/sepolia");
    expect(screen.getByRole("link", { name: "Grid" })).toHaveAttribute("href", "/sepolia?view=grid");
  });

  it("marks the view that is showing, and only that one", () => {
    render(<ViewSwitch chain="sepolia" view="grid" sort="new" q="" />);
    expect(screen.getByRole("link", { name: "Grid" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Table" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the sort and the search when the view changes, and starts again from the first page", () => {
    render(<ViewSwitch chain="sepolia" view="table" sort="mcap" q="dog" />);
    expect(screen.getByRole("link", { name: "Grid" })).toHaveAttribute("href", "/sepolia?sort=mcap&q=dog&view=grid");
  });

  it("is a labelled group, so a screen reader says what the two links are for", () => {
    render(<ViewSwitch chain="sepolia" view="table" sort="new" q="" />);
    expect(screen.getByRole("navigation", { name: "View" })).toBeInTheDocument();
  });
});
