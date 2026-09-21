import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutoSignIn } from "./auto-sign-in";

const hook = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/auth/use-auto-siwe", () => ({ useAutoSiwe: () => void (hook.calls += 1) }));

describe("AutoSignIn", () => {
  it("runs the automatic sign-in, and draws nothing", () => {
    const { container } = render(<AutoSignIn />);
    expect(hook.calls).toBeGreaterThan(0);
    expect(container).toBeEmptyDOMElement();
  });
});
