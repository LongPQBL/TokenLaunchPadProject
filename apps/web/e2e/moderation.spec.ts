import type { Browser, Page } from "@playwright/test";
import { ADMIN_KEY, expect, RPC_URL, sql, test } from "./fixtures";
import { commentsWith, createToken, ensureConnected, main, openCommentsSignedIn, postComment, tag } from "./helpers";
import { installWallet } from "./wallet";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let tokenUrl = "";
let ticker = "";
let creator: Awaited<ReturnType<typeof installWallet>>;
let creatorPage: Page;
let adminPage: Page;
const keep = `keep ${tag()}`;
const spam = `spam ${tag()}`;

/** A page for someone who is not connected at all. */
async function stranger(browser: Browser, url = tokenUrl) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  return page;
}

test.beforeAll(async ({ browser }) => {
  creatorPage = await (await browser.newContext()).newPage();
  creator = await installWallet(creatorPage, RPC_URL);
  ticker = await createToken(creatorPage, { window: "No protection" });
  tokenUrl = creatorPage.url().split("?")[0]!;

  adminPage = await (await browser.newContext()).newPage();
  await installWallet(adminPage, RPC_URL, { privateKey: ADMIN_KEY });
});

test.afterAll(async () => {
  await creatorPage.context().close();
  await adminPage.context().close();
});

/** Signs the admin in, once, from the admin page (the only place that asks nothing else of them). */
async function adminSignedIn() {
  await adminPage.goto("/sepolia/admin");
  await ensureConnected(adminPage);
  const signIn = main(adminPage).getByRole("button", { name: "Sign in" });
  if (
    await signIn.waitFor({ state: "visible", timeout: 5_000 }).then(
      () => true,
      () => false,
    )
  )
    await signIn.click();
  await expect(adminPage.getByLabel("System health")).toBeVisible();
}

// Review Focus 4 (the page's half): the API refuses a non-admin's requests as if the routes did not exist, and the page draws nothing.
test("a non-admin never sees the hide button, on the token or beside a comment, and the page has none to find", async ({ browser }) => {
  await ensureConnected(creatorPage);
  await openCommentsSignedIn(creatorPage);
  await postComment(creatorPage, keep);
  await expect(commentsWith(creatorPage, keep)).toHaveCount(1);
  await postComment(creatorPage, spam);
  await expect(commentsWith(creatorPage, spam)).toHaveCount(1);
  await creatorPage.waitForTimeout(500); // the session's answer has been read by now

  for (const page of [creatorPage, await stranger(browser)]) {
    expect(await page.getByRole("button", { name: /^Hide/ }).count()).toBe(0);
    expect(await page.evaluate(() => /Hide token|Hide this/.test(document.body.innerText))).toBe(false);
  }
});

test("a non-admin, signed in or not, gets nothing from the admin page", async ({ browser }) => {
  await creatorPage.goto("/sepolia/admin");
  await expect(creatorPage.getByText("Page not found.")).toBeVisible();
  await expect(creatorPage.getByLabel("System health")).toHaveCount(0);
  const other = await stranger(browser, "/sepolia/admin");
  await expect(other.getByText("Page not found.")).toBeVisible();
  await expect(other.getByLabel("System health")).toHaveCount(0);
});

test("someone signed in can report a token, and an admin sees the report, as text, and settles it", async ({ browser }) => {
  const reporterPage = await (await browser.newContext()).newPage();
  await installWallet(reporterPage, RPC_URL);
  await reporterPage.goto(tokenUrl);
  await ensureConnected(reporterPage);
  await openCommentsSignedIn(reporterPage);
  const marker = tag();
  await reporterPage.getByRole("button", { name: "Report" }).click();
  await reporterPage.getByRole("textbox", { name: "What is wrong?" }).fill(`<b>scam</b> ${marker}`);
  await reporterPage.getByRole("button", { name: "Send report" }).click();
  await expect(reporterPage.getByText("Thank you. A moderator will look at it.")).toBeVisible();
  await reporterPage.context().close();

  await adminSignedIn();
  const row = adminPage.getByTestId("report-row").filter({ hasText: marker });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("report-reason")).toHaveText(`<b>scam</b> ${marker}`);
  expect(await row.locator("b").count()).toBe(0);
  await row.getByRole("button", { name: "Dismiss" }).click();
  await expect(adminPage.getByTestId("report-row").filter({ hasText: marker })).toHaveCount(0);
});

test("the admin page shows the running system: the watcher is alive and the bot's wallet has a balance", async () => {
  await adminSignedIn();
  const health = adminPage.getByLabel("System health");
  // The bot beats every 15 seconds and once at start-up, so it has been heard from by now.
  await expect(health.getByTestId("health-row").filter({ hasText: "Watcher" })).toContainText("Running, started", { timeout: 30_000 });
  const bot = health.getByTestId("health-row").filter({ hasText: "Bot wallet" });
  await expect(bot).toContainText("ETH");
  await expect(bot).not.toContainText("Unknown");
  await expect(adminPage.getByText("Curves waiting to migrate")).toBeVisible();
});

test("an admin sees hide beside each comment, and hiding one removes it for everyone, keeping the others", async ({ browser }) => {
  await adminSignedIn();
  await adminPage.goto(tokenUrl);
  await adminPage.getByRole("tab", { name: "Comments" }).click();
  const item = adminPage.getByTestId("comment-item").filter({ hasText: spam });
  await item.getByRole("button", { name: "Hide" }).click(); // asks first
  await expect(adminPage.getByRole("dialog")).toContainText("Hide this comment?");
  await expect(commentsWith(adminPage, spam)).toHaveCount(1); // nothing yet
  await adminPage.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
  await expect(commentsWith(adminPage, spam)).toHaveCount(0);
  await expect(commentsWith(adminPage, keep)).toHaveCount(1);

  const other = await stranger(browser);
  await other.getByRole("tab", { name: "Comments" }).click();
  await expect(commentsWith(other, keep)).toHaveCount(1);
  await expect(commentsWith(other, spam)).toHaveCount(0);
  const rows = await sql`select hidden from app.comment where body = ${spam}`;
  expect(rows).toEqual([{ hidden: true }]); // hidden, not deleted
  await other.context().close();
});

test("banning an address takes away its comments and its right to post, and deletes nothing", async ({ browser }) => {
  await adminSignedIn();
  await adminPage.getByRole("textbox", { name: "Address" }).fill(creator.address);
  await adminPage.getByRole("button", { name: "Ban address", exact: true }).click();
  await adminPage.getByRole("dialog").getByRole("button", { name: "Ban" }).click();
  await expect(adminPage.getByText("Banned.")).toBeVisible();

  const other = await stranger(browser);
  await other.getByRole("tab", { name: "Comments" }).click();
  await expect(other.getByText("No comments yet. Be the first to say something.")).toBeVisible();
  await other.context().close();

  await creatorPage.goto(tokenUrl); // (an earlier test left this page on the admin page)
  await ensureConnected(creatorPage);
  await openCommentsSignedIn(creatorPage);
  await postComment(creatorPage, `after the ban ${tag()}`);
  await expect(main(creatorPage).getByRole("alert")).toContainText("You cannot post here.");
  const [row] = await sql`select count(*)::int as n from app.comment where author = ${creator.address.toLowerCase()}`;
  expect(row?.n).toBe(2); // both are still in the table
});

test("hiding a token removes it from the grid, from search and from its own URL, within thirty seconds", async ({ browser }) => {
  await adminSignedIn();
  await adminPage.goto(tokenUrl);
  await adminPage.getByRole("button", { name: "Hide token" }).click();
  await expect(adminPage.getByRole("dialog")).toContainText("Hide this token?");
  const started = Date.now();
  await adminPage.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
  await expect(adminPage).toHaveURL(/\/sepolia$/); // a token that is gone must not stay on screen

  const address = /\/token\/(0x[0-9a-f]{40})/.exec(tokenUrl)![1]!;
  const card = `[data-testid="token-card"][href$="/token/${address}"]`;
  const other = await stranger(browser, "/sepolia");
  await expect(other.locator(card)).toHaveCount(0);
  expect(Date.now() - started).toBeLessThan(30_000);

  await other.getByPlaceholder("Search tokens").fill(ticker);
  await other.getByPlaceholder("Search tokens").press("Enter");
  await expect(other).toHaveURL(new RegExp(`q=${ticker}`));
  await expect(other.getByTestId("token-card")).toHaveCount(0);

  await other.goto(tokenUrl);
  await expect(other.getByText("Token not found.")).toBeVisible();
  await other.context().close();
});

test("the hidden token is gone from its creator's profile too, and an address that never used the launchpad shows an empty state", async ({
  browser,
}) => {
  await creatorPage.goto(`/sepolia/profile/${creator.address}`);
  await expect(creatorPage.getByText("Nothing created yet.")).toBeVisible();

  const unused = `0x${"0123456789abcdef".repeat(3).slice(0, 40)}`;
  const page = await stranger(browser, `/sepolia/profile/${unused}`);
  await expect(page.getByText("Nothing created yet.")).toBeVisible();
  await page.getByRole("tab", { name: "Holdings" }).click();
  await expect(page.getByText("Nothing held yet.")).toBeVisible();
  await expect(main(page).getByRole("alert")).toHaveCount(0); // not an error
  await expect(page.getByRole("button", { name: "Claim creator fees" })).toHaveCount(0);
  await page.context().close();
});
