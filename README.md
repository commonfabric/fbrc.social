# fbrc.social

The link domain for Common Fabric share links.

## Why

A share link to a loom should open in Weaver when the person has Weaver, and in
Web Weaver when they don't. Phones and Macs only hand a link to an app when the
link's domain is public and says which apps may open it, so share links need a
public domain that belongs to Common Fabric rather than to any one service or
Weaver. This repository is that domain's whole website: two association files
and one tiny landing page for the cases where the operating system doesn't
hand the link to Weaver itself.

The design, including the journeys it was graded against, is in the loom
repository at `docs/development/projects/share-links/design.md`.

## What it serves

| Path                                       | What it is                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `/.well-known/apple-app-site-association`  | Lets Weaver on iPhone, iPad and Mac claim `/join` and `/open`.                                 |
| `/join?host&space&invite#code`             | A share link. Without Weaver, goes straight on to Web Weaver; on a Mac browser known to have Weaver, opens Weaver. |
| `/open?…#code`                             | The same link, reached from Web Weaver's **Open in Weaver**: the person asked for Weaver.      |
| `/setup#n&b`                               | Opened by Weaver's onboarding card, so this browser remembers its owner has Weaver.            |

Android's `assetlinks.json` is added once the signing key's fingerprint is
known.

The invitation's code travels after the `#`, which browsers never send to a
server, so this site never sees it. Every page is the same file, run by
`src/route.js`. Its Content-Security-Policy allows only that one inline script
and style, by hash, and no network connections. Web Weaver's address is fixed
in the script and never taken from the link.

## Weavers

Every Weaver, from any maker, answers the `fbrc:` scheme for
invitations, so nothing here lists Weavers for the landing page; on a Mac the
default Weaver opens. The association files do list Weaver apps, because
that list is what lets iPhone, iPad, Mac and Android open a Weaver straight
from Messages, Mail or a chat app. Being on it is a speed-up, not a
requirement: a Weaver that isn't listed still works through the landing page.

To add a Weaver, open a pull request adding its Apple app ID (team ID and
bundle ID) to `APPLE_APP_IDS` in `build.py`, and, once Android is served, its
package name and signing certificate's SHA-256 fingerprint. Apple and Android
pick among several listed apps themselves, so the order of the list matters to
anyone with more than one Weaver installed.

## Working on it

```bash
npm install
npx playwright install chromium-headless-shell
npm test
```

`npm test` builds `site/` and runs the routing tests and the headless browser
tests. With Chrome installed, `PW_CHANNEL=chrome npm test` uses it (still
headless) instead of Playwright's download.

Pushing to `main` publishes `site/` to GitHub Pages.

## Keep in mind

- Apple fetches the association file through its own CDN and refreshes it
  within about a day, so it must be right before a Weaver build claims the
  domain. Serve it directly: no redirect, no bot protection.
- Web Weaver must never live on this domain or a subdomain of it, or Safari
  would treat its **Open in Weaver** action as a same-site click and keep it in
  the browser.
