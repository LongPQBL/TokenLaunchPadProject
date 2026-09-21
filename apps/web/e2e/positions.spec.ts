import { expect, RPC_URL, sql, test } from "./fixtures";
import { createToken, panel } from "./helpers";
import { installWallet } from "./wallet";

// (the database connection is shared by every spec of a worker: the spec that runs last closes it, and closing it here would break the ones after)
test.setTimeout(240_000);

test("says to connect a wallet when there is none, and the button opens the login", async ({ page }) => {
  await page.goto("/sepolia");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Positions" }).click();
  await expect(page).toHaveURL(/\/sepolia\/positions$/);
  await expect(page.getByText("Connect a wallet to see your positions and orders.")).toBeVisible();
  await page.locator("main").getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("dialog", { name: "Connect a wallet" })).toBeVisible();
});

test("a buy shows up as a position with its cost and value, and in the order history; selling it all closes the position and adds an order", async ({ page }) => {
  await installWallet(page, RPC_URL);
  const symbol = await createToken(page, { window: "No protection" });

  await panel(page).getByLabel("Amount to spend (ETH)").fill("0.001");
  await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled();
  await panel(page).getByRole("button", { name: "Buy" }).click();
  await expect(panel(page).getByText(new RegExp(`You bought .* ${symbol} for `))).toBeVisible({ timeout: 45_000 });

  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Positions" }).click();
  const position = page.getByTestId("position-row").filter({ hasText: `Token ${symbol}` });
  // (the indexer is a few seconds behind the chain; the page asks again every 15 s)
  await expect(position).toBeVisible({ timeout: 45_000 });
  const cells = position.getByRole("cell");
  await expect(cells.nth(2)).toHaveText(/^[\d.]+ ETH$/); // value
  await expect(cells.nth(3)).toHaveText(/^0\.001[\d]* ETH$/); // what it cost, fee included
  await expect(cells.nth(4)).toHaveText("—"); // nothing sold yet
  await expect(cells.nth(5)).toHaveText(/^[+-][\d.]+ ETH[+-][\d,]+\.\d%$/);
  await expect(page.getByRole("group", { name: "Totals" })).toContainText("Total value");

  await page.getByRole("navigation", { name: "Positions views" }).getByRole("link", { name: "Order history" }).click();
  await expect(page).toHaveURL(/tab=orders/);
  const orders = page.getByTestId("order-row").filter({ hasText: `Token ${symbol}` });
  await expect(orders).toHaveCount(1, { timeout: 45_000 });
  await expect(orders.first()).toContainText("Buy");
  await expect(orders.first().getByRole("link", { name: "View" })).toHaveAttribute("href", /\/tx\/0x[0-9a-f]{64}$/);

  // Sell it all back.
  await page.goto(page.url().replace("/positions?tab=orders", `/token/${(await sql`select address from launchpad.token where ticker = ${symbol}`)[0]!.address}`));
  await panel(page).getByRole("tab", { name: "Sell" }).click();
  await expect(panel(page).getByRole("button", { name: "Max" })).toBeEnabled({ timeout: 30_000 });
  await panel(page).getByRole("button", { name: "Max" }).click();
  await panel(page).getByRole("button", { name: "Step 1 of 2: approve selling" }).click();
  await expect(panel(page).getByText(new RegExp(`You sold .* ${symbol} and received `))).toBeVisible({ timeout: 60_000 });

  await nav.getByRole("link", { name: "Positions" }).click();
  await page.getByRole("navigation", { name: "Positions views" }).getByRole("link", { name: "Order history" }).click();
  const after = page.getByTestId("order-row").filter({ hasText: `Token ${symbol}` });
  await expect(after).toHaveCount(2, { timeout: 60_000 });
  await expect(after.first()).toContainText("Sell"); // newest first
  await expect(after.last()).toContainText("Buy");

  await page.getByRole("navigation", { name: "Positions views" }).getByRole("link", { name: "Positions" }).click();
  await expect(page.getByTestId("position-row").filter({ hasText: `Token ${symbol}` })).toHaveCount(0, { timeout: 30_000 });
});
