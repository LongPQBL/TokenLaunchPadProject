import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LaunchTaxBanner } from "./launch-tax-banner";

describe("LaunchTaxBanner", () => {
  it("says what buying costs right now, as a multiple, and when it ends", () => {
    render(<LaunchTaxBanner taxBps={9800n} multiplier={50.2} secondsLeft={299} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("50.2×");
    expect(banner).toHaveTextContent("4:59");
  });

  it("counts a 98-minute window in hours", () => {
    render(<LaunchTaxBanner taxBps={9800n} multiplier={50} secondsLeft={5880} />);
    expect(screen.getByRole("status")).toHaveTextContent("1:38:00");
  });

  it("is absent when there is no tax", () => {
    render(<LaunchTaxBanner taxBps={0n} multiplier={1} secondsLeft={0} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is absent while the numbers have not loaded", () => {
    render(<LaunchTaxBanner taxBps={undefined} multiplier={1} secondsLeft={undefined} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
