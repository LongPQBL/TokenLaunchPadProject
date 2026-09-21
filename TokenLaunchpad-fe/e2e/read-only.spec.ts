import { expect, FILLED, LAUNCHPAD, SAME_BLOCK, setMetadata, sql, test } from "./fixtures";

test.afterAll(() => sql.end());

/** A token's row in the table, which is what discover draws unless the URL asks for the grid. */
const card = (address: string) => `[data-testid="token-row"]:has(a[href$="/token/${address}"])`;

test.describe("discover", () => {
  test("shows the testnet badge and both tokens the indexer found", async ({ page }) => {
    await page.goto("/sepolia");
    await expect(page.getByText("SEPOLIA TESTNET")).toBeVisible();
    await expect(page.locator(card(FILLED))).toBeVisible();
    await expect(page.locator(card(SAME_BLOCK))).toBeVisible();
    // The token that graduated says so on its card; the one still on its curve does not.
    await expect(page.locator(card(FILLED))).toContainText("GRADUATED");
    await expect(page.locator(card(SAME_BLOCK))).not.toContainText("GRADUAT");
  });

  test("shows a token whose metadata never resolved, with its on-chain name and a placeholder", async ({ page }) => {
    await page.goto("/sepolia");
    // Both fixture tokens name a metadata URI that is not real IPFS content, so the resolver marked them invalid.
    await expect(page.locator(card(FILLED))).toContainText("Demo Token");
    await expect(page.locator(card(FILLED)).getByTestId("token-image-placeholder")).toBeVisible();
  });

  test("searches by ticker, and puts the search in the URL", async ({ page }) => {
    await page.goto("/sepolia");
    await page.getByPlaceholder("Search tokens").fill("DEMO");
    await page.getByPlaceholder("Search tokens").press("Enter");
    await expect(page).toHaveURL(/[?&]q=DEMO/);
    await expect(page.getByTestId("token-row")).toHaveCount(1);
    await expect(page.locator(card(FILLED))).toBeVisible();
  });

  test("says so when a search matches nothing", async ({ page }) => {
    await page.goto("/sepolia?q=zzzzzzzz");
    await expect(page.getByText("No tokens match that search.")).toBeVisible();
  });

  test("switches the sort by link, and marks the active one", async ({ page }) => {
    await page.goto("/sepolia");
    await page.getByRole("link", { name: "Trending" }).click();
    await expect(page).toHaveURL(/sort=volume/);
    await expect(page.getByRole("link", { name: "Trending" })).toHaveAttribute("aria-current", "page");
    // The busiest token comes first.
    await expect(page.getByTestId("token-row").first().locator('a[href*="/token/"]')).toHaveAttribute("href", new RegExp(`${FILLED}$`));
  });

  // The nav's main link must not lead anywhere broken, even before the create flow exists.
  test("the Create token link leads to the create form, not a 404", async ({ page }) => {
    await page.goto("/sepolia");
    await page.getByRole("link", { name: "Create token" }).click();
    await expect(page).toHaveURL(/\/sepolia\/create$/);
    await expect(page.getByRole("heading", { name: "Create a token" })).toBeVisible();
  });

});

test.describe("the side navigation", () => {
  test("is a rail of icons that opens over the page, showing each page's name, while the pointer is on it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/sepolia");
    const nav = page.getByRole("navigation", { name: "Main" });
    const create = nav.getByRole("link", { name: "Create token" });
    const name = create.getByText("Create token");
    const pageLeft = async () => (await page.getByRole("banner").boundingBox())!.x;
    const before = (await nav.boundingBox())!.width;
    const contentBefore = await pageLeft();
    expect(before).toBeLessThan(80);
    await expect(name).toHaveCSS("opacity", "0");
    await nav.hover();
    await expect(name).toHaveCSS("opacity", "1");
    await expect.poll(async () => (await nav.boundingBox())!.width).toBeGreaterThan(160);
    expect(await pageLeft()).toBe(contentBefore); // it opens over the page and pushes nothing
    await page.mouse.move(700, 400);
    await expect.poll(async () => (await nav.boundingBox())!.width).toBeLessThan(80);
  });

  test("opens for the keyboard too, and marks the page that is open", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/sepolia");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Discover" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Create token" }).focus();
    await expect.poll(async () => (await nav.boundingBox())!.width).toBeGreaterThan(160);
    await nav.getByRole("link", { name: "Create token" }).click();
    await expect(page).toHaveURL(/\/sepolia\/create$/);
    await expect(nav.getByRole("link", { name: "Create token" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Discover" })).not.toHaveAttribute("aria-current", "page");
  });

  test("lists Profile before anyone is connected, and pressing it asks them to connect", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/sepolia");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Profile" })).toHaveCount(0);
    await nav.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("dialog", { name: "Connect a wallet" })).toBeVisible();
  });

  test("is a bar along the bottom on a phone, with the names showing, and does not cover the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/sepolia");
    const nav = page.getByRole("navigation", { name: "Main" });
    const box = (await nav.boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(800, 0);
    expect(box.width).toBeCloseTo(390, 0);
    await expect(nav.getByText("Create token")).toBeVisible();
    await expect(nav.getByText("Create token")).toHaveCSS("opacity", "1");
  });
});

test.describe("a chain that is not configured", () => {
  test.use({ expectedNotFound: ["/nochain", "/nochain/create"] });

  test("is a 404, on the list and on every page beneath it", async ({ page }) => {
    expect((await page.goto("/nochain"))?.status()).toBe(404);
    expect((await page.goto("/nochain/create"))?.status()).toBe(404);
  });
});

test.describe("token page: a graduated token", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/sepolia/token/${FILLED}`);
  });

  test("shows the token, its status, its address and the way to trade it on Uniswap", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Demo Token" })).toBeVisible();
    await expect(page.getByTestId("status-badge")).toHaveText("GRADUATED");
    await expect(page.getByRole("link", { name: FILLED })).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${FILLED}`);
    // The header carries the link, and so does the trading area once the token has moved to Uniswap.
    const uniswap = page.getByRole("link", { name: "Trade on Uniswap" }).first();
    await expect(uniswap).toHaveAttribute("href", new RegExp(`outputCurrency=${FILLED}`));
  });

  test("shows a full curve as collected against its target, not a wei short", async ({ page }) => {
    await expect(page.getByText("0.05 / 0.05 ETH collected")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Graduation progress" })).toHaveAttribute("aria-valuenow", "100");
  });

  test("really draws the chart", async ({ page }) => {
    // Not merely "the container is there": the library must have put a canvas inside it.
    await expect(page.getByTestId("price-chart").locator("canvas").first()).toBeVisible();
  });

  test("offers the candle sizes and draws the chart again in the one chosen", async ({ page }) => {
    const sizes = page.getByRole("group", { name: "Candle size" });
    await expect(sizes.getByRole("button")).toHaveText(["1m", "5m", "1h", "4h", "1d"]);
    await expect(sizes.getByRole("button", { name: "1m" })).toHaveAttribute("aria-pressed", "true");
    for (const size of ["5m", "1h", "4h", "1d", "1m"]) {
      await sizes.getByRole("button", { name: size }).click();
      await expect(sizes.getByRole("button", { name: size })).toHaveAttribute("aria-pressed", "true"); // the size on show is the one chosen once its candles are in
      await expect(page.getByTestId("price-chart").locator("canvas").first()).toBeVisible(); // and the chart is drawn, not blank or broken
    }
    await expect(page.getByRole("alert").filter({ hasText: "Could not load candles" })).toHaveCount(0);
  });

  test("lists the trades, then the holders, without the launchpad or the pool", async ({ page }) => {
    await expect(page.getByTestId("trade-row")).toHaveCount(3); // the flow's buy, sell and final buy
    await expect(page.getByTestId("trade-row").filter({ hasText: "Sell" })).toHaveCount(1);

    await page.getByRole("tab", { name: "Holders" }).click();
    const holders = page.getByTestId("holder-row");
    await expect(holders.first()).toBeVisible();
    for (const column of ["Holder", "Position", "Profit", "% supply"]) await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    const text = (await holders.allTextContents()).join(" ").toLowerCase();
    expect(text).not.toContain(LAUNCHPAD.slice(2, 8));
    expect(text).not.toContain("dead");
    // Every listed holder is a real one, so what is listed cannot exceed the whole supply.
    // (From the "% supply" cell of each row: the text of all the cells of a row run together, so "+$409.19" and "80.00%" read as "409.1980.00%".)
    const shares = (await holders.locator("td:nth-child(4)").allTextContents()).map((t) => Number(/(\d+\.\d+)%/.exec(t)?.[1] ?? Number.NaN));
    expect(shares.length).toBeGreaterThan(0);
    for (const share of shares) expect(share).not.toBeNaN();
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100);
  });

  test("has a Comments tab that says there are none yet, without breaking the strip", async ({ page }) => {
    await page.getByRole("tab", { name: "Comments" }).click();
    await expect(page.getByText("No comments yet. Be the first to say something.")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(3);
  });
});

test.describe("token page: a token still on its curve", () => {
  test("says TRADING, offers no Uniswap link, and lists its three same-block trades", async ({ page }) => {
    await page.goto(`/sepolia/token/${SAME_BLOCK}`);
    await expect(page.getByTestId("status-badge")).toHaveText("TRADING");
    await expect(page.getByRole("link", { name: "Trade on Uniswap" })).toHaveCount(0);
    await expect(page.getByTestId("trade-row")).toHaveCount(3);
    await expect(page.getByTestId("trade-row").filter({ hasText: "Buy" })).toHaveCount(3);
  });
});

test.describe("token page: what is not there", () => {
  test("says so for an address the indexer has not seen", async ({ page }) => {
    await page.goto("/sepolia/token/0x0000000000000000000000000000000000000001");
    await expect(page.getByText("Token not found.")).toBeVisible();
  });

  test("says so for something that is not an address, without asking the API", async ({ page }) => {
    await page.goto("/sepolia/token/not-an-address");
    await expect(page.getByText("Token not found.")).toBeVisible();
  });
});

test.describe("moderation and hostile metadata, through the real stack", () => {
  test("a token hidden in the database disappears from the list and from its own URL", async ({ page }) => {
    const undo = await setMetadata(SAME_BLOCK, { status: "hidden" });
    try {
      await page.goto("/sepolia");
      await expect(page.locator(card(FILLED))).toBeVisible();
      await expect(page.locator(card(SAME_BLOCK))).toHaveCount(0);

      await page.goto("/sepolia?q=SAME");
      await expect(page.getByText("No tokens match that search.")).toBeVisible();

      await page.goto(`/sepolia/token/${SAME_BLOCK}`);
      await expect(page.getByText("Token not found.")).toBeVisible();
    } finally {
      await undo();
    }
    await page.goto("/sepolia");
    await expect(page.locator(card(SAME_BLOCK))).toBeVisible(); // and it comes back when un-hidden
  });

  // A stranger controls these strings. In a real browser they must show up as text and run nothing.
  test("a hostile name, description and link are shown as text and execute nothing", async ({ page }) => {
    const undo = await setMetadata(SAME_BLOCK, {
      status: "ok",
      name: "<img src=x onerror=window.__pwned=1>",
      symbol: "PWN",
      description: "<script>window.__pwned=2</script>",
      socials: { website: "javascript:window.__pwned=3", twitter: "https://x.com/ok" },
    });
    try {
      await page.goto("/sepolia");
      await expect(page.getByText("<img src=x onerror=window.__pwned=1>")).toBeVisible();

      await page.goto(`/sepolia/token/${SAME_BLOCK}`);
      await expect(page.getByRole("heading", { name: "<img src=x onerror=window.__pwned=1>" })).toBeVisible();
      await expect(page.getByText("<script>window.__pwned=2</script>")).toBeVisible();
      // The link that is not http(s) is not a link at all; the one that is, is.
      await expect(page.getByRole("link", { name: "Website" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Twitter" })).toBeVisible();
      await expect(page.locator("a[href^='javascript:']")).toHaveCount(0);
      await expect(page.locator("img[onerror]")).toHaveCount(0);

      // Give any injected handler a chance to fire, then check none did.
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    } finally {
      await undo();
    }
  });
});
