import { expect, FILLED, RPC_URL, SAME_BLOCK, sql, test } from "./fixtures";
import { ensureConnected } from "./helpers";
import { installWallet } from "./wallet";

test.afterAll(() => sql.end());

const row = (page: import("@playwright/test").Page, address: string) => page.locator(`[data-testid="token-row"]:has(a[href$="/token/${address}"])`);

test.describe("the token table", () => {
  test("is what discover shows, with the columns of a token table", async ({ page }) => {
    await page.goto("/sepolia");
    const headers = page.getByRole("columnheader");
    await expect(headers).toHaveText(["Token", "MCAP", "ATH", "AGE", "TXNS", "24H VOL", "TRADERS", "1H", "6H", "24H", "Star"]);
    // (other specs make tokens too, so there may be more than the two fixtures)
    await expect(row(page, FILLED)).toBeVisible();
    await expect(row(page, SAME_BLOCK)).toBeVisible();
  });

  test("shows real numbers for a token that has traded: a market cap, its trades and its traders, and a change for each window", async ({ page }) => {
    await page.goto("/sepolia");
    const cells = row(page, FILLED).getByRole("cell");
    await expect(cells.nth(1)).toHaveText(/^\d[\d.]* ETH$/); // market cap, not a dash
    await expect(cells.nth(4)).toHaveText(/^[\d,]+$/); // trades
    await expect(cells.nth(6)).toHaveText(/^[\d,]+$/); // traders
    for (const i of [7, 8, 9]) await expect(cells.nth(i)).toHaveText(/^(↑ |↓ )?[\d,]+\.\d%$/);
  });

  test("sorts by a column when its header is pressed, and says which one it is sorted by", async ({ page }) => {
    await page.goto("/sepolia");
    await page.getByRole("columnheader", { name: "TXNS" }).getByRole("link").click();
    await expect(page).toHaveURL(/sort=txns/);
    await expect(page.getByRole("columnheader", { name: "TXNS" })).toHaveAttribute("aria-sort", "descending");
    // Most trades first, all the way down.
    const counts = await page.getByTestId("token-row").evaluateAll((rows) => rows.map((r) => Number(r.querySelectorAll("td")[4]!.textContent!.replace(/,/g, ""))));
    expect(counts.length).toBeGreaterThanOrEqual(2);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  });

  test("switches to the grid of cards and back, keeping the search", async ({ page }) => {
    await page.goto("/sepolia?q=DEMO");
    await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Grid" }).click();
    await expect(page).toHaveURL(/view=grid/);
    await expect(page).toHaveURL(/q=DEMO/);
    await expect(page.getByTestId("token-card")).toHaveCount(1);
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Table" }).click();
    await expect(page.getByTestId("token-row")).toHaveCount(1);
    await expect(page).not.toHaveURL(/view=/);
  });

  test("asks someone who is not logged in to connect when they press a star, and stars nothing", async ({ page }) => {
    await page.goto("/sepolia");
    await row(page, FILLED).getByRole("button", { name: /^Star / }).click();
    await expect(page.getByRole("dialog", { name: "Connect a wallet" })).toBeVisible();
    await page.keyboard.press("Escape"); // (behind the dialog the page is hidden from the accessibility tree)
    await expect(row(page, FILLED).getByRole("button", { name: /^Star / })).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("stars", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test("are kept on the account: starred, they are still there after a reload, and gone once unstarred", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await installWallet(page, RPC_URL);
    await page.goto("/sepolia");
    await ensureConnected(page);

    const star = () => row(page, FILLED).getByRole("button", { name: /^Star / });
    await star().click(); // signs in (the wallet signs the message), then stars
    await expect(star()).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, SAME_BLOCK).getByRole("button", { name: /^Star / })).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    await ensureConnected(page);
    await expect(star()).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

    await star().click();
    await expect(star()).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await ensureConnected(page);
    await expect(star()).toHaveAttribute("aria-pressed", "false");
    await page.context().close();
  });

  test("are not shown to someone else", async ({ browser }) => {
    const owner = await (await browser.newContext()).newPage();
    await installWallet(owner, RPC_URL);
    await owner.goto("/sepolia");
    await ensureConnected(owner);
    await row(owner, FILLED).getByRole("button", { name: /^Star / }).click();
    await expect(row(owner, FILLED).getByRole("button", { name: /^Star / })).toHaveAttribute("aria-pressed", "true");

    const other = await (await browser.newContext()).newPage();
    await installWallet(other, RPC_URL);
    await other.goto("/sepolia");
    await ensureConnected(other);
    await expect(row(other, FILLED).getByRole("button", { name: /^Star / })).toHaveAttribute("aria-pressed", "false");
    await owner.context().close();
    await other.context().close();
  });
});
