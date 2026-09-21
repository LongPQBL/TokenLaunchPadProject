import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithWallet, TEST_USER } from "../test/wallet";
import { ExportKeyButton } from "./export-key-button";

const privy = vi.hoisted(() => ({ exportWallet: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({ useExportWallet: () => privy }));

const wallet = (id: string) => {
  const base = mock({ accounts: [TEST_USER] });
  return [(cfg: Parameters<typeof base>[0]) => ({ ...base(cfg), id })];
};

beforeEach(() => {
  localStorage.clear();
  privy.exportWallet.mockReset().mockResolvedValue(undefined);
});

async function show(id: string | undefined) {
  const view = renderWithWallet(<ExportKeyButton />, id ? wallet(id) : []);
  if (id) await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return view;
}

describe("ExportKeyButton", () => {
  it("is drawn for an embedded wallet, and says the key is theirs to take", async () => {
    await show("io.privy.wallet");
    expect(await screen.findByRole("button", { name: "Export key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export key" })).toHaveAttribute("title", expect.stringMatching(/your key is yours/i));
  });

  it("is absent for an external wallet, a look-alike and nobody: there is no key of ours to hand over", async () => {
    for (const id of ["io.metamask", "io.privy.wallet.evil", undefined]) {
      const { container, unmount } = await show(id);
      expect(container.innerHTML, String(id)).toBe("");
      unmount();
    }
  });

  it("opens Privy's own export screen for this wallet's address, and does nothing else: the key never reaches this page", async () => {
    await show("io.privy.wallet");
    await userEvent.click(await screen.findByRole("button", { name: "Export key" }));
    expect(privy.exportWallet).toHaveBeenCalledTimes(1);
    expect(privy.exportWallet.mock.calls[0]![0].address.toLowerCase()).toBe(TEST_USER);
  });

  it("takes it quietly when the person closes Privy's screen", async () => {
    privy.exportWallet.mockRejectedValue(new Error("closed"));
    await show("io.privy.wallet");
    await userEvent.click(await screen.findByRole("button", { name: "Export key" }));
    await waitFor(() => expect(privy.exportWallet).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Export key" })).toBeEnabled();
  });
});
