"""Builds the static site into ./site.

Every HTML page runs the same script, which reads its own path to decide what
to do; only each page's preview (title, Open Graph tags, the heading shown
without the script) differs. The page's Content-Security-Policy allows only its one inline script and
one inline style, by hash, and no network connections, so nothing but this
script ever runs while the invitation's code is in the address.
"""
from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "site"

APPLE_APP_IDS = ["Z2F9QWVXN2.com.commontools.CommonFabricWeaver"]
PAGES = ["index", "join", "open", "setup", "space", "404"]

# What a chat app's preview, and the page before its script runs, says a link
# is. A space link grants nothing, so it is never called an invitation.
PREVIEWS = {
    "space": ("A link to a loom", "Open it in Weaver or your browser."),
}
INVITATION_PREVIEW = ("An invitation to a loom", "Open it to join.")


def sha256(text: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


def web_weaver() -> str:
    m = re.search(r'webWeaver: "([^"]+)"', (SRC / "route.js").read_text())
    if not m:
        raise SystemExit("route.js: CONFIG.webWeaver not found")
    return m.group(1)


def page(name: str) -> str:
    script = (SRC / "route.js").read_text()
    style = (SRC / "page.css").read_text()
    csp = "; ".join([
        "default-src 'none'",
        "script-src " + sha256(script),
        "style-src " + sha256(style),
        "base-uri 'none'",
        "form-action 'none'",
    ])
    html = (SRC / "page.html").read_text()
    title, description = PREVIEWS.get(name, INVITATION_PREVIEW)
    fields = {"CSP": csp, "WEB_WEAVER": web_weaver(), "TITLE": title,
              "DESCRIPTION": description}
    for key, value in fields.items():
        html = html.replace("{{" + key + "}}", value)
    # Last, so the script and style are inserted verbatim.
    html = html.replace("{{STYLE}}", style).replace("{{SCRIPT}}", script)
    if "{{" in html.replace(script, "").replace(style, ""):
        raise SystemExit("page.html: unreplaced placeholder")
    return html


def apple_app_site_association() -> str:
    return json.dumps({
        "applinks": {
            "details": [{
                "appIDs": APPLE_APP_IDS,
                "components": [
                    {"/": "/join", "comment": "an invitation"},
                    {"/": "/open", "comment": "an invitation, opened from Web Weaver"},
                    {"/": "/space", "comment": "a link to a loom, which grants nothing"},
                ],
            }],
        },
    }, indent=2) + "\n"


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / ".well-known").mkdir(parents=True)
    for name in PAGES:
        (OUT / (name + ".html")).write_text(page(name))
    (OUT / ".well-known" / "apple-app-site-association").write_text(apple_app_site_association())
    # Apple's CDN fetches this file with no redirect and parses it as JSON;
    # check the built file, which is what Pages serves.
    built = json.loads((OUT / ".well-known" / "apple-app-site-association").read_text())
    paths = [c["/"] for c in built["applinks"]["details"][0]["components"]]
    if paths != ["/join", "/open", "/space"]:
        raise SystemExit("apple-app-site-association: unexpected paths " + repr(paths))
    print("built", OUT)


if __name__ == "__main__":
    main()
