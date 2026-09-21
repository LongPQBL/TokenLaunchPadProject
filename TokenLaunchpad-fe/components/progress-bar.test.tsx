import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./progress-bar";

const fill = () => screen.getByRole("progressbar").firstElementChild as HTMLElement;

describe("ProgressBar", () => {
  it("draws how far along a curve is, and says it in words", () => {
    render(<ProgressBar bps={2500} label="Graduation progress" />);
    const bar = screen.getByRole("progressbar", { name: "Graduation progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(fill().style.width).toBe("25%");
  });

  it("is the primary colour and still, until the curve is full", () => {
    render(<ProgressBar bps={9999} label="p" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("data-full");
    expect(fill()).toHaveClass("bg-primary");
    expect(fill()).not.toHaveClass("progress-full");
  });

  it("changes colour and gets an effect once it is full: that is the moment worth noticing", () => {
    render(<ProgressBar bps={10_000} label="p" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-full", "true");
    expect(fill()).toHaveClass("bg-success", "progress-full");
    expect(fill()).not.toHaveClass("bg-primary");
    expect(fill().style.width).toBe("100%");
  });

  it("keeps the fill inside its box whatever it is given, and treats more than full as full", () => {
    const { rerender } = render(<ProgressBar bps={12_000} label="p" />);
    expect(fill().style.width).toBe("100%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-full", "true");
    rerender(<ProgressBar bps={-5} label="p" />);
    expect(fill().style.width).toBe("0%");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("data-full");
    rerender(<ProgressBar bps={Number.NaN} label="p" />);
    expect(fill().style.width).toBe("0%");
  });

  it("takes its size from the caller, so one bar serves a table row, a card and a page", () => {
    render(<ProgressBar bps={10} label="p" className="h-1.5 w-16" />);
    expect(screen.getByRole("progressbar")).toHaveClass("h-1.5", "w-16");
  });
});
