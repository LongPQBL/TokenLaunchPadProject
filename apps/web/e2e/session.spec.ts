import type { Page } from "@playwright/test";
import { expect, RPC_URL, test } from "./fixtures";
import { createToken, ensureConnected, panel, spendEth } from "./helpers";
import { installWallet } from "./wallet";

test.setTimeout(180_000);

// What a person has to confirm in their wallet: signing a message, sending a transaction, or anything like it.
const PROMPTS = ["personal_sign", "eth_sign", "eth_signTypedData_v4", "eth_sendTransaction", "wallet_sendCalls"];
const prompts = (requests: string[]) => requests.filter((m) => PROMPTS.includes(m)).length;
const count = (requests: string[], method: string) => requests.filter((m) => m === method).length;

const bar = (page: Page) => page.getByTestId("trading-wallet");

async function enableSession(page: Page) {
  await page.getByRole("button", { name: "Turn on trading wallet" }).click();
  await expect(bar(page)).toBeVisible({ timeout: 20_000 });
}

async function topUp(page: Page, amount: "0.1" | "0.2" | "0.3") {
  await bar(page).getByRole("button", { name: "Top up" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: `${amount} ETH` }).click();
  await dialog.getByRole("button", { name: "Send from main wallet" }).click();
  await expect(dialog.getByText(new RegExp(`^Sent ${amount} ETH\\. Your trading wallet now has`))).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
}

const sessionAddress = async (page: Page) => (await bar(page).locator("[title]").first().getAttribute("title"))!;
const tokenOf = (page: Page) => /\/token\/(0x[0-9a-f]{40})/.exec(page.url())![1]!;

async function buy(page: Page, eth: string, symbol: string) {
  await spendEth(page, eth);
  await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled({ timeout: 30_000 });
  await panel(page).getByRole("button", { name: "Buy" }).click();
  await expect(panel(page).getByText(new RegExp(`You bought .* ${symbol} for `))).toBeVisible({ timeout: 60_000 });
}

test("buy and sell with no wallet prompt after the trading wallet is set up", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL);
  const symbol = await createToken(page, { window: "No protection" });

  await enableSession(page);
  await topUp(page, "0.2");
  const asked = prompts(wallet.requests);
  const signatures = count(wallet.requests, "personal_sign");

  // Trade, twice over: a purchase, then a sale that has to approve first. Not one of these may reach the main wallet.
  await buy(page, "0.01", symbol);
  await panel(page).getByRole("tab", { name: "Sell" }).click();
  await expect(panel(page).getByRole("button", { name: "Max" })).toBeEnabled({ timeout: 30_000 });
  await panel(page).getByRole("button", { name: "Max" }).click();
  await panel(page).getByRole("button", { name: "Step 1 of 2: approve selling" }).click();
  await expect(panel(page).getByText(new RegExp(`You sold .* ${symbol} and received `))).toBeVisible({ timeout: 90_000 });

  expect(prompts(wallet.requests)).toBe(asked);
  expect(count(wallet.requests, "personal_sign")).toBe(signatures);
  // ...and before that, exactly what was asked for: sign in + sign the session message, create the token + the top-up.
  expect(count(wallet.requests, "personal_sign")).toBe(2);
  expect(count(wallet.requests, "eth_sendTransaction")).toBe(2);
});

test("clearing all storage and signing again recovers the same trading wallet and its balance", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL);
  await createToken(page, { window: "No protection" });
  await enableSession(page);
  await topUp(page, "0.2");
  const before = await sessionAddress(page);
  // The balance is drawn in dollars; the ETH it is (to the wei that matters here) is in its tooltip.
  const balanceBefore = await bar(page).locator('[title$=" ETH"]').first().getAttribute("title");
  expect(balanceBefore).toBe("0.2 ETH");

  // Everything a browser keeps: what a new browser, a new machine or "clear site data" amounts to.
  await page.context().clearCookies();
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("vezta-session");
      request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
    });
  });
  await page.reload();
  await ensureConnected(page); // (the wallet still trusts the site, so it may reconnect on its own)

  // The wallet has to be asked once more, and it gives back the very same one.
  const signed = count(wallet.requests, "personal_sign");
  await enableSession(page);
  expect(count(wallet.requests, "personal_sign")).toBe(signed + 1);
  expect(await sessionAddress(page)).toBe(before);
  await expect(bar(page).locator('[title="0.2 ETH"]').first()).toBeVisible({ timeout: 30_000 });
});

test("withdraw all empties the trading wallet of ETH and tokens", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL);
  const symbol = await createToken(page, { window: "No protection" });
  await enableSession(page);
  await topUp(page, "0.2");
  await buy(page, "0.01", symbol);
  const session = await sessionAddress(page);
  const token = tokenOf(page);

  const balanceOf = async (owner: string) =>
    BigInt((await wallet.rpc("eth_call", [{ to: token, data: `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"])) as string);
  const eth = async (owner: string) => BigInt((await wallet.rpc("eth_getBalance", [owner, "latest"])) as string);
  expect(await balanceOf(session)).toBeGreaterThan(0n);

  await bar(page).getByRole("button", { name: "Withdraw all" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Withdraw everything" }).click();
  await expect(dialog.getByText(/^Sent 1 token and .* ETH to your main wallet\.$/)).toBeVisible({ timeout: 90_000 });

  expect(await balanceOf(session)).toBe(0n); // every token
  // The ETH is sent less the most the transfer could cost, and the actual cost is a little under that: a sliver stays.
  expect(await eth(session)).toBeLessThan(10n ** 14n);
  expect(await balanceOf(wallet.address)).toBeGreaterThan(0n); // and it is with the main wallet now

  // and it is safe to press again
  await dialog.getByRole("button", { name: "Withdraw everything" }).click();
  await expect(dialog.getByText(/nothing left|too small/i)).toBeVisible({ timeout: 60_000 });
});

test("a curve that fills is migrated by the bot without anyone pressing anything", async ({ page }) => {
  await installWallet(page, RPC_URL);
  await createToken(page, { window: "No protection" });

  await spendEth(page, "0.2"); // far more than the curve needs
  await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled();
  await panel(page).getByRole("button", { name: "Buy" }).click();

  await expect(panel(page).getByText("GRADUATING…")).toBeVisible({ timeout: 60_000 });
  // Nobody calls migrate. The bot sees Complete and does.
  const uniswap = panel(page).getByRole("link", { name: "Trade on Uniswap" });
  await expect(uniswap).toBeVisible({ timeout: 90_000 });
  await expect(panel(page).getByText("GRADUATING…")).toHaveCount(0);
});

test("a trade in another tab appears live in this one, with no reload", async ({ browser }) => {
  const trader = await (await browser.newContext()).newPage();
  const watcher = await (await browser.newContext()).newPage();
  await installWallet(trader, RPC_URL);
  const symbol = await createToken(trader, { window: "No protection" });
  const url = trader.url();

  await watcher.goto(url);
  await expect(watcher.getByTestId("trade-panel")).toBeVisible({ timeout: 90_000 });
  await watcher.evaluate(() => ((window as unknown as { __opened: number }).__opened = 1)); // proves the page is not reloaded
  await expect(watcher.getByTestId("trade-row")).toHaveCount(0);

  await buy(trader, "0.001", symbol);

  await expect(watcher.getByTestId("trade-row")).toHaveCount(1, { timeout: 30_000 });
  await expect(watcher.getByTestId("trade-row").first()).toContainText("Buy");
  expect(await watcher.evaluate(() => (window as unknown as { __opened?: number }).__opened)).toBe(1);
});
