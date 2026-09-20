import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mock } from "wagmi/connectors";
import { renderWithWallet, TEST_USER } from "@/test/wallet";
import { ConnectButton } from "./connect-button";

describe("ConnectButton", () => {
  it("offers to connect a wallet when none is connected", () => {
    renderWithWallet(<ConnectButton />);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });

  it("lists the detected wallets in a dialog, and connects the one picked", async () => {
    const user = userEvent.setup();
    renderWithWallet(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /mock/i }));
    // Once connected the button is the person's shortened address, and there is a way back out.
    await waitFor(() => expect(screen.getByText(/^0x0000…00a1$/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disconnects", async () => {
    const user = userEvent.setup();
    renderWithWallet(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    await user.click(screen.getByRole("button", { name: /mock/i }));
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });

  it("says so when there is no wallet at all, instead of an empty list", async () => {
    const user = userEvent.setup();
    renderWithWallet(<ConnectButton />, []);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByText(/No wallet found/)).toBeInTheDocument();
  });

  it("keeps the dialog open and stays calm when the person declines the connection", async () => {
    const user = userEvent.setup();
    const declining = mock({ accounts: [TEST_USER], features: { connectError: true } });
    renderWithWallet(<ConnectButton />, [declining]);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    await user.click(screen.getByRole("button", { name: /mock/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
