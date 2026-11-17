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
    if (p === "/tampered") {
      // An edge feature rewriting the inline script breaks its CSP hash.
      const page = fs.readFileSync(path.join(SITE, "join.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page.replace("<script>", "<script> "));
      return;
    }
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
  await context.route(CONFIG.webWeaver + "/**", (route) =>
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

test("a known Mac browser shows Opening Weaver, and the code leaves the address", async (t) => {
  const { page, violations } = await open(t, { known: true });
  // The launch of fbrc:// keeps the page from ever reporting "load".
  await page.goto(origin + "/join" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opening"]').waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => location.hash), "");
  const web = await page.locator('[data-view="opening"] [data-web]').getAttribute("href");
  assert.equal(web, CONFIG.webWeaver + "/join" + QUERY + "#code=s3cret");
  assert.deepEqual(violations, []);

});

const stored = (page) => page.evaluate((k) => localStorage.getItem(k), CONFIG.storageKey);

// What a browser does when an app takes the link: the window loses focus. A
// real one can't happen here without an app to launch.
const blur = (page) => page.evaluate(() => window.dispatchEvent(new Event("blur")));
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
});
const pagehide = (page) => page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

async function openFromWebWeaver(t) {
  const { page, violations } = await open(t, { known: false });
  // The launch of fbrc:// keeps the page from ever reporting "load".
  await page.goto(origin + "/open" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opening"]').waitFor({ state: "visible" });
  return { page, violations };
}

test("/open on a Mac says Opening Weaver and remembers nothing yet", async (t) => {
  const { page, violations } = await openFromWebWeaver(t);
  assert.equal(await stored(page), null);
  const web = page.locator('[data-view="opening"] [data-web]');
  assert.equal(await web.getAttribute("href"), CONFIG.webWeaver + "/join" + QUERY + "#code=s3cret");
  assert.deepEqual(violations, []);
});

test("/open remembers Weaver when the window loses focus after the launch", async (t) => {
  const { page } = await openFromWebWeaver(t);
  await blur(page);
  assert.equal(await stored(page), "1");
});

test("closing the tab or going Back after /open remembers nothing", async (t) => {
  const { page } = await openFromWebWeaver(t);
  // Unloading hides the page first, then fires pagehide.
  await hide(page);
  await pagehide(page);
  // Focus moving after the page has gone, or been cached for Back, is not
  // the app either.
  await blur(page);
  assert.equal(await stored(page), null);
});

test("Continue in browser from /open remembers nothing, even if focus leaves after", async (t) => {
  const { page } = await openFromWebWeaver(t);
  // Stop the navigation so the page is still there to blur.
  await page.locator('[data-view="opening"] [data-web]').evaluate((a) =>
    a.addEventListener("click", (e) => e.preventDefault()));
  await page.locator('[data-view="opening"] [data-web]').click();
  await blur(page);
  assert.equal(await stored(page), null);
});

test("a known browser keeps Weaver when the launch takes focus away", async (t) => {
  const { page } = await open(t, { known: true });
  await page.goto(origin + "/join" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opening"]').waitFor({ state: "visible" });
  await blur(page);
  assert.equal(await stored(page), "1");
});

test("a browser wrongly known to have Weaver unsticks itself after one link", async (t) => {
  const { page } = await open(t, { known: true });
  await page.goto(origin + "/join" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opening"]').waitFor({ state: "visible" });
  // Nothing took the link, so nothing took focus.
  assert.equal(await stored(page), null);

  // The next link, in a new tab, goes straight to Web Weaver.
  const next = await page.context().newPage();
  await next.goto(origin + "/join" + QUERY + "#code=again");
  await next.waitForURL(CONFIG.webWeaver + "/**");
  assert.equal(next.url(), CONFIG.webWeaver + "/join" + QUERY + "#code=again");
});

test("Continue in browser forgets a Weaver remembered on false evidence", async (t) => {
  const { page } = await open(t, { known: true });
  await page.goto(origin + "/join" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opening"]').waitFor({ state: "visible" });
  // A browser's "can't open this address" alert takes focus too.
  await blur(page);
  assert.equal(await stored(page), "1");
  await page.locator('[data-view="opening"] [data-web]').click();
  await page.waitForURL(CONFIG.webWeaver + "/**");

  // The next link goes straight to Web Weaver.
  await page.goto(origin + "/join" + QUERY + "#code=again");
  await page.waitForURL(CONFIG.webWeaver + "/**");
  assert.equal(page.url(), CONFIG.webWeaver + "/join" + QUERY + "#code=again");
});

test("an unknown path shows the home view and runs under the CSP", async (t) => {
  const { page, violations } = await open(t, { known: false });
  await page.goto(origin + "/nothing-here");
  await page.locator('[data-view="home"]').waitFor({ state: "visible" });
  assert.deepEqual(violations, []);
});

test("a reload after the launch has no code left and opens nothing", async (t) => {
  const { page } = await open(t, { known: true });
  await page.goto(origin + "/join" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opening"]').waitFor({ state: "visible" });
  await page.reload();
  await page.locator('[data-view="stale"]').waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-view="opening"]').isVisible(), false);
});

test("if the script is blocked, the page says so instead of going blank", async (t) => {
  const { page, violations } = await open(t, { known: false });
  await page.goto(origin + "/tampered" + QUERY + "#code=s3cret");
  assert.equal(await page.locator('[data-view="fallback"]').isVisible(), true);
  assert.ok(violations.length > 0, "expected the CSP to block the altered script");
});

test("the fallback never shows when the script runs", async (t) => {
  const { page } = await open(t, { known: true });
  await page.goto(origin + "/join" + QUERY + "#code=s3cret", { waitUntil: "commit" });
  await page.locator('[data-view="opening"]').waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-view="fallback"]').isVisible(), false);
});

test("without Weaver, /space lands on Web Weaver's /space with the loom named", async (t) => {
  const SPACE = "?host=https%3A%2F%2Festuary.example&space=did%3Akey%3Az6Mk1";
  const { page, violations } = await open(t, { known: false });
  await page.goto(origin + "/space" + SPACE);
  await page.waitForURL(CONFIG.webWeaver + "/**");
  assert.equal(page.url(), CONFIG.webWeaver + "/space" + SPACE);
  assert.deepEqual(violations, []);
});

test("/space previews as a link to a loom, not an invitation", () => {
  const space = fs.readFileSync(path.join(SITE, "space.html"), "utf8");
  const join = fs.readFileSync(path.join(SITE, "join.html"), "utf8");
  assert.match(space, /<meta property="og:title" content="A link to a loom">/);
  assert.match(space, /<title>A link to a loom<\/title>/);
  assert.doesNotMatch(space, /An invitation/);
  assert.match(join, /<meta property="og:title" content="An invitation to a loom">/);
});

test("the association file does not claim /space until a released Weaver reads it", () => {
  const aasa = JSON.parse(fs.readFileSync(path.join(SITE, ".well-known", "apple-app-site-association"), "utf8"));
  const paths = aasa.applinks.details[0].components.map((c) => c["/"]);
  assert.deepEqual(paths, ["/join", "/open"]);
});
