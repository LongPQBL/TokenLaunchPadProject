import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Report } from "@/lib/types";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { ReportsTable } from "./reports-table";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_URL", API));
afterEach(() => vi.unstubAllEnvs());

const TOKEN = "0x00000000000000000000000000000000000000b2";
const NOW = 1_700_000_600;
const report = (o: Partial<Report> = {}): Report => ({
  id: "4",
  token: TOKEN,
  name: "Spam Coin",
  ticker: "SPM",
  reporter: "0x00000000000000000000000000000000000000a1",
  reason: "it is a scam",
  createdAt: 1_700_000_000n,
  hidden: false,
  ...o,
});
const show = (items: Report[], over: { onResolve?: (id: string) => Promise<void>; onChanged?: () => void } = {}) => {
  const onResolve = over.onResolve ?? vi.fn().mockResolvedValue(undefined);
  const onChanged = over.onChanged ?? vi.fn();
  render(<ReportsTable chain="sepolia" items={items} now={NOW} onResolve={onResolve} onChanged={onChanged} />);
  return { onResolve, onChanged };
};

describe("ReportsTable", () => {
  it("says there is nothing to deal with, rather than showing an empty table", () => {
    show([]);
    expect(screen.getByText("No open reports.")).toBeInTheDocument();
  });

  it("shows what was reported, why, by whom and how long ago, with a link to the token", () => {
    show([report()]);
    const row = screen.getByTestId("report-row");
    expect(row).toHaveTextContent("Spam Coin");
    expect(row).toHaveTextContent("SPM");
    expect(row).toHaveTextContent("it is a scam");
    expect(row).toHaveTextContent("reported by 0x0000…00a1");
    expect(row).toHaveTextContent("10m ago");
    expect(within(row).getByRole("link", { name: /0x0000…00b2/ })).toHaveAttribute("href", `/sepolia/token/${TOKEN}`);
  });

  it("draws a reason and a name that are markup as text, with direction controls removed", () => {
    const rlo = String.fromCharCode(0x202e);
    show([report({ reason: `<img src=x onerror=alert(1)>${rlo}`, name: "<b>bold</b>" })]);
    expect(screen.getByTestId("report-reason").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByTestId("report-reason")).toHaveClass("break-all");
  });

  it("marks a token that is already hidden, and does not offer to hide it again", () => {
    show([report({ hidden: true })]);
    expect(screen.getByTestId("report-row")).toHaveTextContent("hidden");
    expect(screen.queryByRole("button", { name: "Hide token" })).toBeNull();
  });

  it("dismisses a report, and says nothing more: the list refreshes without it", async () => {
    const { onResolve } = show([report()]);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onResolve).toHaveBeenCalledWith("4");
  });

  it("says why a dismissal failed, and lets it be tried again", async () => {
    show([report()], { onResolve: vi.fn().mockRejectedValue(new Error("boom")) });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  it("hides the reported token after asking, and tells the page to refresh", async () => {
    const hidden: string[] = [];
    server.use(
      http.post(
        `${API}/sepolia/admin/tokens/:address/hide`,
        ({ params }) => (hidden.push(String(params.address)), HttpResponse.json({ hidden: true })),
      ),
    );
    const { onChanged } = show([report()]);
    await userEvent.click(screen.getByRole("button", { name: "Hide token" }));
    expect(hidden).toEqual([]); // asked first
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(hidden).toEqual([TOKEN]);
  });
});
