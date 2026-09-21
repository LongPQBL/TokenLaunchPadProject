import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copy-button";

const ADDRESS = "0x00000000000000000000000000000000000000a1";
afterEach(() => vi.useRealTimers());

describe("CopyButton", () => {
  it("puts the address on the clipboard and says it did, for a moment", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyButton text={ADDRESS} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("goes back to Copy address after two seconds", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CopyButton text={ADDRESS} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_100)));
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("stays quiet, and does not say Copied, when the browser refuses: the address is on screen to copy by hand", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    render(<CopyButton text={ADDRESS} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});
