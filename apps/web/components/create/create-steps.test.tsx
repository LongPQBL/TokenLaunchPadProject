import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreateSteps } from "./create-steps";

const items = () => screen.getAllByRole("listitem");

describe("CreateSteps", () => {
  it("shows the three steps, in order", () => {
    render(<CreateSteps current="upload" />);
    expect(items().map((i) => i.textContent)).toEqual(["Upload details", "Confirm in your wallet", "Token live"]);
  });

  it("marks the step in progress, and only that one, as current", () => {
    render(<CreateSteps current="confirm" />);
    const current = items().filter((i) => i.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Confirm in your wallet");
  });

  it("marks finished steps as done and later ones as waiting", () => {
    render(<CreateSteps current="confirm" />);
    expect(items().map((i) => i.dataset.state)).toEqual(["done", "current", "waiting"]);
  });

  it("has every step waiting before anything starts", () => {
    render(<CreateSteps current={undefined} />);
    expect(items().map((i) => i.dataset.state)).toEqual(["waiting", "waiting", "waiting"]);
  });

  it("has every step done once the token is live", () => {
    render(<CreateSteps current="done" />);
    expect(items().map((i) => i.dataset.state)).toEqual(["done", "done", "done"]);
  });
});
