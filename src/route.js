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
  // The invitation scheme every Weaver answers, from any maker; the Mac's
  // default Weaver gets it.
  scheme: "fbrc",
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
  return p === "/join" || p === "/open" || p === "/setup" || p === "/space"
    ? p.slice(1)
    : "";
}

// in: { pathname, search, hash, host, fresh, ua, platform, maxTouchPoints,
//       known }
// out: { view, redirect?, launch?, remember?, rememberOnLeave?, keepHash?,
//        web?, link? }
//
// remember: Weaver itself sent the browser here, so it has Weaver.
// rememberOnLeave: forget Weaver, fire the launch, and remember it again only
// if the window then loses focus, the one sign a browser gives that an app
// took the link. Opening "fbrc:" with no app to answer it fails silently in
// most browsers, so the launch alone proves nothing, and each launch has to
// earn the remember afresh: a browser wrongly known to have Weaver learns
// otherwise on its next link. It is a heuristic: a browser's own "Open
// Weaver?" prompt or "can't open" alert also takes focus, and so does
// switching tabs by hand. Being hidden is not counted, since closing the tab
// or going Back hides the page too.
function decide(i) {
  var route = routeOf(i.pathname);
  var device = deviceOf(i.ua, i.platform, i.maxTouchPoints);
  var fragment = new URLSearchParams(i.hash.replace(/^#/, ""));

  if (route === "setup") {
    var nonce = fragment.get("n");
    if (device !== "mac" || !nonce) return { view: "setup-failed" };
    var reply = new URLSearchParams({ n: nonce });
    return {
      view: "setup",
      remember: true,
      launch: i.fresh ? CONFIG.scheme + "://setup?" + reply.toString() : null,
    };
  }
  if (route === "") return { view: "home" };

  if (route === "space") {
    // A link to a loom, which grants nothing (the SDK's space link): it names
    // the service and the space, and carries no code, so nothing is kept
    // from the fragment and any reload may open it again. It goes where an
    // invitation would; the client says whether this person has access.
    var query = new URLSearchParams(i.search);
    if (!query.has("host") && !query.has("space")) return { view: "home" };
    if (IN_APP.test(i.ua)) {
      return { view: "in-app", link: "https://" + i.host + "/space" + i.search };
    }
    // Every Weaver released so far refuses an fbrc.social or fbrc: link it
    // does not know, with no way on to the browser, so a known Mac would
    // strand its owner there. Until a released Weaver reads `fbrc://space`,
    // a space link goes to Web Weaver for everyone, and the association file
    // does not claim it.
    return { view: "redirect", redirect: CONFIG.webWeaver + "/space" + i.search };
  }

  var code = fragment.get("code");
  var link = "https://" + i.host + "/join" + i.search + i.hash;
  var web = CONFIG.webWeaver + "/join" + i.search + i.hash;
  var weaver = CONFIG.scheme + "://join" + i.search + i.hash;

  // The code is removed from the address after the first visit, so a reload,
  // a back button or a restored tab has nothing left to open.
  if (!code) return { view: "stale" };
  // Nothing is launched here, and the app's own "Open in Safari/Chrome" menu
  // item takes the current address, so the code stays in it.
  if (IN_APP.test(i.ua)) return { view: "in-app", link: link, keepHash: true };

  if (route === "join") {
    if (device === "mac" && i.known) {
      return {
        view: "opening",
        rememberOnLeave: true,
        launch: i.fresh ? weaver : null,
        web: web,
      };
    }
    return { view: "redirect", redirect: web };
  }

  // route === "open": the person asked for Weaver.
  if (device === "mac") {
    return {
      view: "opening",
      rememberOnLeave: true,
      launch: i.fresh ? weaver : null,
      web: web,
    };
  }
  if (device === "android") {
    // Names the scheme and no app, so Android hands it to whichever Weaver
    // answers it, or to the fallback when none does.
    var intent = "intent://join" + i.search + "#Intent;" +
      "scheme=" + CONFIG.scheme + ";" +
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

  // Set before the body draws: hides the fallback that shows only if this
  // script never runs.
  w.document.documentElement.className = "js";
  if (d.redirect) {
    loc.replace(d.redirect);
    return;
  }
  if (d.remember) write(true);
  // Keep the code only in memory from here on, so a reload, the back button or
  // a restored tab has nothing left to open.
  if (loc.hash && !d.keepHash) {
    w.history.replaceState(null, "", loc.pathname + loc.search);
  }

  function show() {
    var doc = w.document;
    var section = doc.querySelector('[data-view="' + d.view + '"]');
    if (section) section.hidden = false;
    doc.querySelectorAll("[data-web]").forEach(function (a) {
      a.href = d.web || CONFIG.webWeaver;
      a.addEventListener("click", function () {
        // Someone who continues in the browser didn't get Weaver this time,
        // so stop sending their links to it; this also undoes a remember
        // made on misleading evidence.
        disarm();
        write(false);
      });
    });
    doc.querySelectorAll("[data-get-weaver]").forEach(function (a) {
      a.href = CONFIG.getWeaver;
    });
    doc.querySelectorAll("[data-link]").forEach(function (el) {
      el.textContent = d.link || "";
    });
    doc.querySelectorAll("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var copied = w.navigator.clipboard
          ? w.navigator.clipboard.writeText(d.link)
          : Promise.reject(new Error("no clipboard"));
        copied.then(function () {
          b.textContent = "Copied";
        }, function () {
          // Many in-app browsers refuse the clipboard: select the link
          // instead, so a long-press copies it.
          var shown = doc.querySelector("[data-link]");
          var range = doc.createRange();
          range.selectNodeContents(shown);
          var sel = w.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          b.textContent = "Press and hold the link to copy it";
        });
      });
    });
    if (d.launch) {
      if (d.rememberOnLeave) {
        write(false);
        // Armed before the launch, so an app that comes forward at once is
        // seen.
        w.addEventListener("blur", left);
        // Leaving the page is no evidence; nor is focus moving after it has
        // gone or been put away in the back-forward cache.
        w.addEventListener("pagehide", disarm);
      }
      loc.href = d.launch;
    }
  }
  function left() {
    disarm();
    write(true);
  }
  function disarm() {
    w.removeEventListener("blur", left);
    w.removeEventListener("pagehide", disarm);
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
