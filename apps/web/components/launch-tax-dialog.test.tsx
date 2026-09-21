import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LaunchTaxGuard } from "./launch-tax-dialog";

function setup(taxBps: bigint, multiplier = 50.2) {
  const onBuy = vi.fn();
  render(
    <LaunchTaxGuard taxBps={taxBps} multiplier={multiplier}>
      <button onClick={onBuy}>Buy</button>
    </LaunchTaxGuard>,
  );
  return { onBuy, user: userEvent.setup() };
}

describe("LaunchTaxGuard", () => {
  it("lets a buy through untouched when there is no tax", async () => {
    const { onBuy, user } = setup(0n, 1);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(onBuy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets a buy through under 10%: a small tax is not worth an interruption", async () => {
    const { onBuy, user } = setup(999n, 1.1);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(onBuy).toHaveBeenCalledOnce();
  });

  it("blocks the buy behind a confirmation from 10% up", async () => {
    const { onBuy, user } = setup(1000n, 1.1);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(onBuy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocks a one-click buy at 98% tax", async () => {
    const { onBuy, user } = setup(9800n);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(onBuy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("states the multiplier and the percentage, because a percentage alone does not land", async () => {
    const { user } = setup(9800n);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/50\.2×/);
    expect(dialog).toHaveTextContent(/98%/);
  });

  it("proceeds only after an explicit confirmation", async () => {
    const { onBuy, user } = setup(9800n);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    await user.click(screen.getByRole("button", { name: "Buy anyway" }));
    expect(onBuy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels without buying", async () => {
    const { onBuy, user } = setup(9800n);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBuy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // The tax falls every second: a confirmation given a minute ago authorises a price the person never saw.
  it("asks again for the next buy instead of remembering the confirmation", async () => {
    const { onBuy, user } = setup(9800n);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    await user.click(screen.getByRole("button", { name: "Buy anyway" }));
    expect(onBuy).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(onBuy).toHaveBeenCalledOnce(); // not a second time
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the multiplier as the tax stands when the dialog is open, not as it stood when it opened", async () => {
    const onBuy = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <LaunchTaxGuard taxBps={9800n} multiplier={50.2}>
        <button onClick={onBuy}>Buy</button>
      </LaunchTaxGuard>,
    );
    await user.click(screen.getByRole("button", { name: "Buy" }));
    rerender(
      <LaunchTaxGuard taxBps={9000n} multiplier={10}>
        <button onClick={onBuy}>Buy</button>
      </LaunchTaxGuard>,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(/10\.0×/);
    expect(screen.getByRole("dialog")).toHaveTextContent(/90%/);
  });

  it("does not guard a sell: a sell is never taxed, so the panel gives it no tax to guard", async () => {
    const { onBuy, user } = setup(0n, 1);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(onBuy).toHaveBeenCalledOnce();
  });
});
