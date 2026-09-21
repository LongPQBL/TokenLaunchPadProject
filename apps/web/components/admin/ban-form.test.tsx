import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { BanForm } from "./ban-form";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_API_URL", API));
afterEach(() => vi.unstubAllEnvs());

const ADDRESS = "0x00000000000000000000000000000000000000a1";
const box = () => screen.getByRole("textbox", { name: "Address" });
const banButton = () => screen.getByRole("button", { name: "Ban address" });

function banRoute(status = 200, code = "internal") {
  const banned: string[] = [];
  server.use(
    http.post(`${API}/sepolia/admin/users/:address/ban`, ({ params }) => {
      banned.push(String(params.address));
      return status === 200
        ? HttpResponse.json({ address: params.address, bannedAt: "1" })
        : HttpResponse.json({ error: code, message: "x" }, { status });
    }),
  );
  return banned;
}

describe("BanForm", () => {
  it("will not ban until what was typed is an address", async () => {
    render(<BanForm chain="sepolia" />);
    expect(banButton()).toBeDisabled();
    for (const bad of ["bob", "0x123", `${ADDRESS}0`, "0xZZ00000000000000000000000000000000000001"]) {
      await userEvent.clear(box());
      await userEvent.type(box(), bad);
      expect(banButton(), bad).toBeDisabled();
    }
    await userEvent.clear(box());
    await userEvent.type(box(), ADDRESS);
    expect(banButton()).toBeEnabled();
  });

  it("asks first, then bans, ignoring the spaces around a pasted address", async () => {
    const banned = banRoute();
    render(<BanForm chain="sepolia" />);
    await userEvent.type(box(), `  ${ADDRESS}  `);
    await userEvent.click(banButton());
    expect(banned).toEqual([]);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Ban this address?");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ban" }));
    await waitFor(() => expect(banned).toEqual([ADDRESS]));
    expect(await screen.findByText("Banned.")).toBeInTheDocument();
    expect(box()).toHaveValue("");
  });

  it("does nothing on Cancel", async () => {
    const banned = banRoute();
    render(<BanForm chain="sepolia" />);
    await userEvent.type(box(), ADDRESS);
    await userEvent.click(banButton());
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(banned).toEqual([]);
    expect(box()).toHaveValue(ADDRESS);
  });

  it("says why and keeps the address when the server refuses", async () => {
    banRoute(500);
    render(<BanForm chain="sepolia" />);
    await userEvent.type(box(), ADDRESS);
    await userEvent.click(banButton());
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Ban" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    // (the dialog is still open, so the page behind it is hidden from the accessibility tree)
    expect(screen.getByRole("textbox", { name: "Address", hidden: true })).toHaveValue(ADDRESS);
  });
});
