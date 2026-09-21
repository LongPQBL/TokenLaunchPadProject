import type { Page } from "@playwright/test";
import { expect, FILLED, RPC_URL, test } from "./fixtures";
import { connect, createToken, ensureConnected, panel, spendEth } from "./helpers";
import { installWallet } from "./wallet";

test.setTimeout(180_000);

// What a person has to confirm in their wallet: signing a message, sending a transaction, or anything like it.
const PROMPTS = ["personal_sign", "eth_sign", "eth_signTypedData_v4", "eth_sendTransaction", "wallet_sendCalls"];
const prompts = (requests: string[]) => requests.filter((m) => PROMPTS.includes(m)).length;
const count = (requests: string[], method: string) => requests.filter((m) => m === method).length;

// The trading wallet is in the header: its balance and short address on the chip, and behind it the whole address (the wallet menu).
const chip = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Wallet" });

async function topUp(page: Page, amount: "0.1" | "0.2" | "0.3") {
  // Deposit is in the header, beside the network badge: it works from any page.
  await page.getByRole("banner").getByRole("button", { name: "Deposit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: `${amount} ETH` }).click();
  await dialog.getByRole("button", { name: "Send from main wallet" }).click();
  await expect(dialog.getByText(new RegExp(`^Sent ${amount} ETH\\. Your trading wallet now has`))).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
}

async function sessionAddress(page: Page) {
  await chip(page).click();
  const address = (await page.getByLabel("Address", { exact: true }).textContent())!.trim();
  await page.keyboard.press("Escape");
  return address;
}
const tokenOf = (page: Page) => /\/token\/(0x[0-9a-f]{40})/.exec(page.url())![1]!;

async function buy(page: Page, eth: string, symbol: string) {
  await spendEth(page, eth);
  await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled({ timeout: 30_000 });
  await panel(page).getByRole("button", { name: "Buy" }).click();
  await expect(panel(page).getByText(new RegExp(`You bought .* ${symbol} for `))).toBeVisible({ timeout: 60_000 });
}

/** The trading wallet opens by itself when a wallet connects: the header offers Deposit only once it is there. */
const opened = (page: Page) => expect(page.getByRole("banner").getByRole("button", { name: "Deposit" })).toBeVisible({ timeout: 30_000 });
const ethBalance = async (page: Page) => (await chip(page).locator('[title$=" ETH"]').first().getAttribute("title"))!;

test("the trading wallet opens by itself with ONE signature, and creating, buying and selling never reach the main wallet", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL);
  const symbol = await createToken(page, { window: "No protection" });
  await opened(page);
  expect((await sessionAddress(page)).toLowerCase()).toBe(wallet.tradingAddress.toLowerCase());
  // The wallets are in the header (the chip and its menu): the trading panel of the token page does not list them.
  await expect(page.getByTestId("trade-panel").getByText(/trading wallet|main wallet/i)).toHaveCount(0);

  // Trade, twice over: a purchase, then a sale that has to approve first.
  await buy(page, "0.01", symbol);
  await panel(page).getByRole("tab", { name: "Sell" }).click();
  await expect(panel(page).getByRole("button", { name: "Max" })).toBeEnabled({ timeout: 30_000 });
  await panel(page).getByRole("button", { name: "Max" }).click();
  await panel(page).getByRole("button", { name: "Step 1 of 2: approve selling" }).click();
  await expect(panel(page).getByText(new RegExp(`You sold .* ${symbol} and received `))).toBeVisible({ timeout: 90_000 });

  // The main wallet was asked for exactly one thing, in all: the message that opens the trading wallet. Signing in to the API is done
  // by the trading wallet's own key, and the token was created, bought and sold from it.
  expect(count(wallet.requests, "personal_sign")).toBe(1);
  expect(count(wallet.requests, "eth_sendTransaction")).toBe(0);
  expect(prompts(wallet.requests)).toBe(1);
});

test("top up moves ETH from the main wallet into the trading wallet, in one confirmation", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL, { tradingEth: 0 });
  await page.goto(`/sepolia/token/${FILLED}`);
  await connect(page);
  await opened(page);
  expect(await ethBalance(page)).toBe("0 ETH");
  await topUp(page, "0.2");
  expect(count(wallet.requests, "eth_sendTransaction")).toBe(1);
  await expect.poll(() => ethBalance(page), { timeout: 30_000 }).toBe("0.2 ETH");
});

test("clearing all storage and signing again recovers the same trading wallet and its balance", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL, { tradingEth: 0 });
  await page.goto(`/sepolia/token/${FILLED}`);
  await connect(page);
  await opened(page);
  await topUp(page, "0.2");
  const before = await sessionAddress(page);
  await expect.poll(() => ethBalance(page), { timeout: 30_000 }).toBe("0.2 ETH");

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
  const signed = count(wallet.requests, "personal_sign");
  await page.reload();
  await ensureConnected(page); // (the wallet still trusts the site, so it may reconnect on its own)

  // The wallet is asked once more, by itself, and it gives back the very same trading wallet, with its funds.
  await opened(page);
  expect(count(wallet.requests, "personal_sign")).toBe(signed + 1);
  expect(await sessionAddress(page)).toBe(before);
  await expect.poll(() => ethBalance(page), { timeout: 30_000 }).toBe("0.2 ETH");
});

test("withdraw all empties the trading wallet of ETH and tokens", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL);
  const symbol = await createToken(page, { window: "No protection" });
  await opened(page);
  await buy(page, "0.01", symbol);
  const session = await sessionAddress(page);
  const token = tokenOf(page);

  const balanceOf = async (owner: string) =>
    BigInt((await wallet.rpc("eth_call", [{ to: token, data: `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"])) as string);
  const eth = async (owner: string) => BigInt((await wallet.rpc("eth_getBalance", [owner, "latest"])) as string);
  expect(await balanceOf(session)).toBeGreaterThan(0n);

  // Withdraw all is in the wallet menu: the chip with the balance and address, in the header.
  await page.getByRole("banner").getByRole("button", { name: "Wallet" }).click();
  await page.getByRole("button", { name: "Withdraw all" }).click();
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
