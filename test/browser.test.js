"use strict";
// Loads the built site in headless Chromium, served the way GitHub Pages
// serves it (`/join` is `join.html`), to check what unit tests can't: the CSP
// lets the one script run and nothing else, the redirect keeps the code, and
// the code leaves the address bar.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { CONFIG } = require("../src/route.js");

const SITE = path.join(__dirname, "..", "site");
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const QUERY = "?host=https%3A%2F%2Festuary.example&space=did%3Akey%3Az6Mk1&invite=abc";

let server, origin, browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    const file = path.join(SITE, p === "/" ? "index.html" : p.slice(1) + (path.extname(p) ? "" : ".html"));
    fs.readFile(file, (err, body) => {
      res.writeHead(err ? 404 : 200, { "content-type": "text/html" });
      res.end(err ? fs.readFileSync(path.join(SITE, "404.html")) : body);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  // PW_CHANNEL=chrome uses an installed Chrome (still headless) instead of
  // Playwright's own download.
  browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

async function open(t, { known }) {
  const context = await browser.newContext({ userAgent: MAC_UA });
  t.after(() => context.close());
  const violations = [];
  const page = await context.newPage();
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.route(CONFIG.webWeaver + "/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "web weaver" }));
  if (known) {
    await page.goto(origin + "/");
    await page.evaluate((k) => localStorage.setItem(k, "1"), CONFIG.storageKey);
  }
  return { page, violations };
}

test("without Weaver, /join lands on Web Weaver with the code intact", async (t) => {
  const { page, violations } = await open(t, { known: false });
  await page.goto(origin + "/join" + QUERY + "#code=s3cret");
  await page.waitForURL(CONFIG.webWeaver + "/**");
  assert.equal(page.url(), CONFIG.webWeaver + "/join" + QUERY + "#code=s3cret");
  assert.deepEqual(violations, []);
});

test("a known Mac browser shows Opened in Weaver, and the code leaves the address", async (t) => {
  const { page, violations } = await open(t, { known: true });
  // The launch of cfweaver:// keeps the page from ever reporting "load".
  await page.goto(origin + "/join" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opened"]').waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => location.hash), "");
  const web = await page.locator('[data-view="opened"] [data-web]').getAttribute("href");
  assert.equal(web, CONFIG.webWeaver + "/join" + QUERY + "#code=s3cret");
  assert.deepEqual(violations, []);

  // Continuing in the browser forgets that this browser has Weaver.
  await page.locator('[data-view="opened"] [data-web]').click();
  await page.waitForURL(CONFIG.webWeaver + "/**");
  await page.goto(origin + "/");
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), CONFIG.storageKey), null);
});

test("an unknown path shows the home view and runs under the CSP", async (t) => {
  const { page, violations } = await open(t, { known: false });
  await page.goto(origin + "/nothing-here");
  await page.locator('[data-view="home"]').waitFor({ state: "visible" });
  assert.deepEqual(violations, []);
});
