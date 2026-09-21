import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WindowPicker } from "./window-picker";

describe("WindowPicker", () => {
  it("offers exactly the four windows the contract accepts, in words", () => {
    render(<WindowPicker value={60} onChange={() => {}} />);
    const options = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent);
    expect(options).toEqual(["No protection", "60 seconds", "10 minutes", "98 minutes"]);
  });

  it("has each option stand for its number of seconds", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WindowPicker value={60} onChange={onChange} />);
    for (const [label, seconds] of [["No protection", 0], ["10 minutes", 600], ["98 minutes", 5880]] as const) {
      await user.click(screen.getByRole("radio", { name: label }));
      expect(onChange).toHaveBeenLastCalledWith(seconds);
    }
    // 60 is already chosen above, so it only reports once something else is: check it from another starting point.
    const other = vi.fn();
    render(<WindowPicker value={0} onChange={other} />);
    await user.click(screen.getAllByRole("radio", { name: "60 seconds" })[1]!);
    expect(other).toHaveBeenCalledWith(60);
  });

  it("shows which one is chosen", () => {
    render(<WindowPicker value={600} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "10 minutes" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "60 seconds" })).not.toBeChecked();
  });

  it("warns that the creator pays the tax too, because that is what surprises people", () => {
    render(<WindowPicker value={60} onChange={() => {}} />);
    expect(screen.getByText("You pay the launch tax too, on your own buys.")).toBeInTheDocument();
  });

  it("is a labelled group, so a screen reader announces what the choices are for", () => {
    render(<WindowPicker value={60} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Launch protection" })).toBeInTheDocument();
  });
});
