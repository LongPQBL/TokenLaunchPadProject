import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenListItem } from "@/lib/types";
import { SearchBox } from "./search-box";

const api = vi.hoisted(() => ({ tokens: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), api }));

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const item = (address: string, name: string, ticker: string): TokenListItem => ({
  address,
  creator: "0xc0ffee",
  name,
  ticker,
  progressBps: 0,
  volumeQuote: 0n,
  tradeCount: 0,
  complete: false,
  migrated: false,
  createdAt: 1n,
});

beforeEach(() => {
  api.tokens.mockReset();
  router.push.mockReset();
});

const box = () => screen.getByRole("combobox", { name: "Search tokens" });

describe("SearchBox: suggestions", () => {
  it("shows nothing, and asks for nothing, until something is typed", () => {
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(api.tokens).not.toHaveBeenCalled();
  });

  it("asks the API for tokens matching what was typed, after a short pause, and lists what starts with it", async () => {
    api.tokens.mockResolvedValue({ items: [item("0xb1", "Bored Ape", "BAPE"), item("0xb2", "Bitcoin Baby", "BABY")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "b");
    await waitFor(() => expect(api.tokens).toHaveBeenCalledWith("sepolia", expect.objectContaining({ q: "b" })));
    expect(await screen.findByRole("option", { name: /Bored Ape/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Bitcoin Baby/ })).toBeInTheDocument();
  });

  it("only offers tokens that start with what was typed, not ones that merely contain it somewhere", async () => {
    api.tokens.mockResolvedValue({ items: [item("0xb1", "Bored Ape", "BAPE"), item("0xc1", "Zebra Coin", "ZEB")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "b");
    expect(await screen.findByRole("option", { name: /Bored Ape/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Zebra Coin/ })).toBeNull();
  });

  it("matches on the ticker too, not only the name", async () => {
    api.tokens.mockResolvedValue({ items: [item("0xb1", "Something Else", "BAPE")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "bap");
    expect(await screen.findByRole("option", { name: /BAPE/ })).toBeInTheDocument();
  });

  it("narrows the list as more letters are typed", async () => {
    api.tokens.mockResolvedValueOnce({ items: [item("0xb1", "Bored Ape", "BAPE"), item("0xb2", "Bitcoin Baby", "BABY")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "b");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    api.tokens.mockResolvedValueOnce({ items: [item("0xb1", "Bored Ape", "BAPE")] });
    await user.type(box(), "o");
    await waitFor(() => expect(api.tokens).toHaveBeenLastCalledWith("sepolia", expect.objectContaining({ q: "bo" })));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByRole("option", { name: /Bored Ape/ })).toBeInTheDocument();
  });

  it("says when nothing starts with what was typed", async () => {
    api.tokens.mockResolvedValue({ items: [item("0xc1", "Zebra Coin", "ZEB")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "b");
    expect(await screen.findByText("No tokens found")).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("goes straight to a token's page when it is picked from the list", async () => {
    api.tokens.mockResolvedValue({ items: [item("0xb1", "Bored Ape", "BAPE")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "b");
    await user.click(await screen.findByRole("option", { name: /Bored Ape/ }));
    expect(router.push).toHaveBeenCalledWith("/sepolia/token/0xb1");
  });

  it("closes the list on Escape, without clearing what was typed", async () => {
    api.tokens.mockResolvedValue({ items: [item("0xb1", "Bored Ape", "BAPE")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "b");
    await screen.findByRole("option", { name: /Bored Ape/ });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box()).toHaveValue("b");
  });

  it("picks the highlighted suggestion with the down arrow and Enter, instead of submitting the plain search", async () => {
    api.tokens.mockResolvedValue({ items: [item("0xb1", "Bored Ape", "BAPE")] });
    const user = userEvent.setup();
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    await user.type(box(), "b");
    await screen.findByRole("option", { name: /Bored Ape/ });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(router.push).toHaveBeenCalledWith("/sepolia/token/0xb1");
  });

  it("still points the plain form at a search of its own, for Enter with nothing picked", () => {
    render(<SearchBox chain="sepolia" sort="new" q="" />);
    expect(box().closest("form")).toHaveAttribute("action", "/sepolia");
    expect(box().closest("form")).toHaveAttribute("method", "get");
  });
});
