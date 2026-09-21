import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its label", () => {
    render(<Button>Create token</Button>);
    expect(screen.getByRole("button", { name: "Create token" })).toBeInTheDocument();
  });

  it("is not clickable while disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Buy</Button>);
    expect(screen.getByRole("button", { name: "Buy" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Buy" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls its handler when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Sell</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
