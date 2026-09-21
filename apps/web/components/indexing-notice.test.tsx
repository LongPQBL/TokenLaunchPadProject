import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexingNotice } from "./indexing-notice";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  vi.useFakeTimers();
  router.refresh.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("IndexingNotice", () => {
  it("says the token is being set up, calmly, and not that it does not exist", () => {
    render(<IndexingNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("Your token is being set up. This page will update in a moment.");
  });

  it("asks the page to load again every 3 seconds", () => {
    render(<IndexingNotice />);
    expect(router.refresh).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(3_000));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(6_000));
    expect(router.refresh).toHaveBeenCalledTimes(3);
  });

  it("gives up after about two minutes and then says the token was not found, instead of retrying for ever", () => {
    render(<IndexingNotice />);
    act(() => void vi.advanceTimersByTime(3_000 * 40));
    const calls = router.refresh.mock.calls.length;
    expect(calls).toBe(40);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(router.refresh).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("alert")).toHaveTextContent("Token not found.");
  });

  it("stops asking when it goes away", () => {
    const { unmount } = render(<IndexingNotice />);
    unmount();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
