"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { decide, CONFIG } = require("../src/route.js");

const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
};

const SEARCH = "?host=https%3A%2F%2Festuary.example&space=did%3Akey%3Az6Mk1&invite=abc";
const HASH = "#code=s3cret";

function visit(over) {
  return decide(Object.assign({
    pathname: "/join",
    search: SEARCH,
    hash: HASH,
    host: "fbrc.social",
    fresh: true,
    ua: UA.mac,
    platform: "MacIntel",
    maxTouchPoints: 0,
    known: false,
  }, over));
}

const WEB = CONFIG.webWeaver + "/join" + SEARCH + HASH;
const WEAVER = "fbrc://join" + SEARCH + HASH;

test("someone without Weaver goes straight to Web Weaver, on every device", () => {
  for (const ua of [UA.mac, UA.iphone, UA.android, UA.windows]) {
    const d = visit({ ua });
    assert.equal(d.view, "redirect");
    assert.equal(d.redirect, WEB);
    assert.equal(d.launch, undefined);
  }
});

test("the redirect target is fixed, whatever host the link names", () => {
  const search = "?host=https%3A%2F%2Fevil.example&space=x&invite=y";
  const d = visit({ search, host: "evil.example" });
  assert.equal(d.redirect, CONFIG.webWeaver + "/join" + search + HASH);
  assert.equal(new URL(d.redirect).origin, new URL(CONFIG.webWeaver).origin);
});

test("a Mac browser known to have Weaver tries it at once, and claims nothing yet", () => {
  const d = visit({ known: true });
  assert.equal(d.view, "opening");
  assert.equal(d.launch, WEAVER);
  assert.equal(d.web, WEB);
  assert.equal(d.keepHash, undefined);
  assert.equal(d.remember, undefined);
});

test("a known Mac browser never relaunches on reload, back or restore", () => {
  for (const pathname of ["/join", "/open"]) {
    const d = visit({ pathname, known: true, fresh: false });
    assert.equal(d.view, "opening");
    assert.equal(d.launch, null);
  }
});

test("only a Mac is ever treated as having Weaver", () => {
  for (const [ua, maxTouchPoints] of [[UA.iphone, 5], [UA.ipad, 5], [UA.android, 5], [UA.windows, 0]]) {
    const d = visit({ ua, maxTouchPoints, known: true });
    assert.equal(d.view, "redirect", ua);
  }
});

test("/open on a Mac tries Weaver and remembers it only once the page is left", () => {
  const d = visit({ pathname: "/open" });
  assert.equal(d.view, "opening");
  assert.equal(d.launch, WEAVER);
  assert.equal(d.web, WEB);
  // Firing the scheme is no evidence Weaver took it.
  assert.equal(d.remember, undefined);
  assert.equal(d.rememberOnLeave, true);
});

test("nothing but /setup remembers Weaver before there is evidence", () => {
  const cases = [];
  for (const pathname of ["/join", "/open", "/setup", "/"]) {
    for (const [ua, maxTouchPoints] of [[UA.mac, 0], [UA.iphone, 5], [UA.android, 5], [UA.windows, 0]]) {
      for (const known of [true, false]) {
        const hash = pathname === "/setup" ? "#n=N1" : HASH;
        const d = visit({ pathname, ua, maxTouchPoints, known, hash });
        if (d.remember) cases.push(pathname + " " + ua);
      }
    }
  }
  assert.deepEqual(cases, ["/setup " + UA.mac, "/setup " + UA.mac]);
});

test("/open on an iPhone says Weaver didn't open, and never fires the scheme", () => {
  const d = visit({ pathname: "/open", ua: UA.iphone, maxTouchPoints: 5 });
  assert.equal(d.view, "not-opened");
  assert.equal(d.launch, undefined);
  assert.equal(d.remember, undefined);
  assert.equal(d.web, WEB);
});

test("/open on Android names the scheme, not an app, and hands the code over as an extra", () => {
  const d = visit({ pathname: "/open", ua: UA.android, maxTouchPoints: 5 });
  assert.equal(d.view, "not-opened");
  assert.equal(
    d.launch,
    "intent://join" + SEARCH + "#Intent;scheme=fbrc;S.code=s3cret;S.browser_fallback_url=" +
      encodeURIComponent(WEB) + ";end",
  );
  assert.equal(d.remember, undefined);
});

test("/open off Apple and Android goes to Web Weaver", () => {
  assert.equal(visit({ pathname: "/open", ua: UA.windows }).redirect, WEB);
});

test("an in-app browser is asked to open the link elsewhere, before anything else", () => {
  const d = visit({ ua: UA.instagram, known: true });
  assert.equal(d.view, "in-app");
  assert.equal(d.link, "https://fbrc.social/join" + SEARCH + HASH);
  // The app's "Open in Safari" takes the current address, code included.
  assert.equal(d.keepHash, true);
  assert.equal(d.redirect, undefined);
  assert.equal(d.launch, undefined);
});

test("a link with no code left has nothing to open", () => {
  for (const known of [true, false]) {
    const d = visit({ hash: "", known, fresh: false });
    assert.equal(d.view, "stale");
    assert.equal(d.redirect, undefined);
    assert.equal(d.launch, undefined);
  }
});

test("/setup on a Mac remembers Weaver and replies with only the nonce", () => {
  const d = visit({ pathname: "/setup", search: "", hash: "#n=N1&b=chrome" });
  assert.equal(d.view, "setup");
  assert.equal(d.remember, true);
  assert.equal(d.launch, "fbrc://setup?n=N1");
});

test("/setup without a nonce, or off a Mac, changes nothing", () => {
  for (const over of [{ hash: "#b=chrome" }, { ua: UA.iphone, maxTouchPoints: 5 }]) {
    const d = visit(Object.assign({ pathname: "/setup", search: "", hash: "#n=N1" }, over));
    assert.equal(d.view, "setup-failed");
    assert.equal(d.remember, undefined);
    assert.equal(d.launch, undefined);
  }
});

test("pages are reached with or without .html or a trailing slash", () => {
  for (const pathname of ["/join", "/join.html", "/join/"]) {
    assert.equal(visit({ pathname }).view, "redirect", pathname);
  }
  assert.equal(visit({ pathname: "/" }).view, "home");
  assert.equal(visit({ pathname: "/joinx" }).view, "home");
});
