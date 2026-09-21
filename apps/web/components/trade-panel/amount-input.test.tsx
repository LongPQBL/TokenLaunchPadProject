import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AmountInput } from "./amount-input";

function Harness({ prefix = "$" }: { prefix?: string }) {
  const [value, setValue] = useState("");
  return <AmountInput id="a" label="Amount to spend (USD)" prefix={prefix} value={value} onChange={setValue} />;
}

describe("AmountInput", () => {
  it("is a text box with the label as its name, that brings up a decimal keypad on a phone", () => {
    render(<Harness />);
    const box = screen.getByRole("textbox", { name: "Amount to spend (USD)" });
    expect(box).toHaveAttribute("inputmode", "decimal");
    expect(box).toHaveAttribute("autocomplete", "off");
  });

  it("shows the currency sign beside the number, and hides it from a screen reader (the label already says it)", () => {
    render(<Harness />);
    expect(screen.getByText("$")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws no sign when there is none, as for an amount of tokens", () => {
    render(<Harness prefix="" />);
    expect(screen.queryByText("$")).toBeNull();
  });

  it("passes what is typed on", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole("textbox"), "2.5");
    expect(screen.getByRole("textbox")).toHaveValue("2.5");
  });

  it("makes the text box wide enough for what is in it, so a long number is not cut off", async () => {
    render(<Harness />);
    const box = screen.getByRole("textbox");
    const empty = box.getAttribute("size");
    await userEvent.type(box, "1234567.89");
    expect(Number(box.getAttribute("size"))).toBeGreaterThan(Number(empty));
  });
});
