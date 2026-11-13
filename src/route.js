// The landing page's whole program. It runs only when the operating system did
// not hand a link to Weaver itself, and decides from what this browser has
// learned about its owner where the link goes next. `decide` is pure and is
// what the tests cover; `run` applies its answer to the page.
//
// Design: loom docs/development/projects/share-links/design.md.
"use strict";

// Fixed addresses, never taken from the link, so a crafted link cannot send
// the invitation's code anywhere else.
var CONFIG = {
  webWeaver: "https://web-weaver.saga-castor.ts.net",
  scheme: "cfweaver",
  androidPackage: "com.commontools.CommonFabricWeaver",
  getWeaver: "https://commonfabric.com/",
  storageKey: "has-weaver",
};

// Apps whose built-in browsers lose the identity a guest makes once they
// close, and often refuse to open other apps.
var IN_APP = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|Pinterest|Line\/|; wv\)/;

function deviceOf(ua, platform, maxTouchPoints) {
  if (/Android/.test(ua)) return "android";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // iPadOS asks for desktop sites and reports itself as a Mac with touch.
  if (/Macintosh/.test(ua)) return maxTouchPoints > 1 ? "ios" : "mac";
  if (platform === "MacIntel" && maxTouchPoints > 1) return "ios";
  return "other";
}

function routeOf(pathname) {
  var p = pathname.replace(/\.html$/, "").replace(/\/+$/, "");
  return p === "/join" || p === "/open" || p === "/setup" ? p.slice(1) : "";
}

// in: { pathname, search, hash, host, fresh, ua, platform, maxTouchPoints,
//       known }
// out: { view, redirect?, launch?, remember?, forget?, web?, weaver?,
//        link? }
function decide(i) {
  var route = routeOf(i.pathname);
  var device = deviceOf(i.ua, i.platform, i.maxTouchPoints);
  var fragment = new URLSearchParams(i.hash.replace(/^#/, ""));

  if (route === "setup") {
    var nonce = fragment.get("n");
    if (device !== "mac" || !nonce) return { view: "setup-failed" };
    var reply = new URLSearchParams({ n: nonce, b: fragment.get("b") || "" });
    return {
      view: "setup",
      remember: true,
      launch: i.fresh ? CONFIG.scheme + "://setup?" + reply.toString() : null,
    };
  }
  if (route === "") return { view: "home" };

  var code = fragment.get("code");
  var link = "https://" + i.host + "/join" + i.search + i.hash;
  var web = CONFIG.webWeaver + "/join" + i.search + i.hash;
  var weaver = CONFIG.scheme + "://join" + i.search + i.hash;

  // The code is removed from the address after the first visit, so a reload,
  // a back button or a restored tab has nothing left to open.
  if (!code) return { view: "stale" };
  if (IN_APP.test(i.ua)) return { view: "in-app", link: link };

  if (route === "join") {
    if (device === "mac" && i.known) {
      return i.fresh
        ? { view: "opened", launch: weaver, web: web, weaver: weaver }
        : { view: "choose", web: web, weaver: weaver };
    }
    return { view: "redirect", redirect: web };
  }

  // route === "open": the person asked for Weaver.
  if (device === "mac") {
    return {
      view: "opened",
      remember: true,
      launch: i.fresh ? weaver : null,
      web: web,
      weaver: weaver,
    };
  }
  if (device === "android") {
    var intent = "intent://" + i.host + "/join" + i.search + "#Intent;" +
      "scheme=https;package=" + CONFIG.androidPackage + ";" +
      "S.code=" + encodeURIComponent(code) + ";" +
      "S.browser_fallback_url=" + encodeURIComponent(web) + ";end";
    return { view: "not-opened", launch: i.fresh ? intent : null, web: web };
  }
  if (device === "ios") return { view: "not-opened", web: web };
  return { view: "redirect", redirect: web };
}

function run(w) {
  var store = null;
  try {
    store = w.localStorage;
  } catch (_) { /* storage blocked: nothing is known or remembered */ }
  function read() {
    try {
      return store !== null && store.getItem(CONFIG.storageKey) === "1";
    } catch (_) {
      return false;
    }
  }
  function write(on) {
    try {
      if (store === null) return;
      if (on) store.setItem(CONFIG.storageKey, "1");
      else store.removeItem(CONFIG.storageKey);
    } catch (_) { /* best effort; the page still routes */ }
  }

  var nav = w.performance && w.performance.getEntriesByType
    ? w.performance.getEntriesByType("navigation")[0]
    : null;
  var loc = w.location;
  var d = decide({
    pathname: loc.pathname,
    search: loc.search,
    hash: loc.hash,
    host: loc.host,
    fresh: !nav || nav.type === "navigate",
    ua: w.navigator.userAgent,
    platform: w.navigator.platform || "",
    maxTouchPoints: w.navigator.maxTouchPoints || 0,
    known: read(),
  });

  if (d.redirect) {
    loc.replace(d.redirect);
    return;
  }
  if (d.remember) write(true);
  // Keep the code only in memory from here on.
  if (loc.hash) w.history.replaceState(null, "", loc.pathname + loc.search);

  function show() {
    var doc = w.document;
    var section = doc.querySelector('[data-view="' + d.view + '"]');
    if (section) section.hidden = false;
    doc.querySelectorAll("[data-web]").forEach(function (a) {
      a.href = d.web || CONFIG.webWeaver;
      a.addEventListener("click", function () {
        // A browser where Weaver didn't open has learned the wrong thing.
        write(false);
      });
    });
    doc.querySelectorAll("[data-weaver]").forEach(function (a) {
      if (d.weaver) a.href = d.weaver;
    });
    doc.querySelectorAll("[data-get-weaver]").forEach(function (a) {
      a.href = CONFIG.getWeaver;
    });
    doc.querySelectorAll("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        w.navigator.clipboard.writeText(d.link).then(function () {
          b.textContent = "Copied";
        });
      });
    });
    if (d.launch) loc.href = d.launch;
  }
  if (w.document.readyState === "loading") {
    w.document.addEventListener("DOMContentLoaded", show);
  } else show();
}

if (typeof module !== "undefined") {
  module.exports = { decide: decide, CONFIG: CONFIG };
} else {
  run(window);
}
