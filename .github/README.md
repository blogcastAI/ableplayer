# Able Player — blogcastAI fork

A fork of [**ableplayer/ableplayer**](https://github.com/ableplayer/ableplayer), the fully
accessible cross-browser HTML5 media player created by Terrill Thompson and maintained by
Joe Dolson. MIT licensed, same as upstream.

**Looking for Able Player itself?** Use the upstream repository. Player documentation —
setup, attributes, keyboard shortcuts, translations — lives in this repo's
[root README.md](../README.md), which is kept byte-identical to upstream.

---

## Why this fork exists

[perks.locker](https://perkslocker.com) uses Able Player as its media surface. This fork is
our working copy: it lets us move at our own pace, run our own quality gates, and host a
public demo — while contributing the generally useful pieces back upstream.

We are not a competing distribution. We do not publish releases, and we do not want anyone
depending on this fork as a source of Able Player.

## Live demo

**https://ableplayer.perkslocker.com/demos/**

Every demo page in the repository, served from a Cloudflare Worker and deployed
automatically on each push to `develop`. Each page carries a banner stating the version,
branch, and commit it was built from, so nothing here is mistaken for an official release.

The demo runs `develop` (currently `5.1.0-alpha`), which is **ahead of the last upstream
release**. Behaviour you see there may not match a released Able Player.

## Branches

| Branch | What it is |
|---|---|
| `develop` *(default)* | Upstream `develop` plus the fork-local additions below. What the live demo serves. |
| `main` | An exact mirror of `upstream/main`. Never modified here. |
| `upstream/*` | One topic branch per upstream contribution — each cut from `upstream/develop` and containing only that change. |

Branch protection on `develop` requires five green checks before merge: ESLint,
Jest (jsdom), Jest (puppeteer, headless), Build (Grunt + Rollup), and
Accessibility (axe + keyboard, 320px–4K).

## What this fork adds

None of this is in upstream, and all of it is confined to fork-only paths so upstream
contributions stay clean:

| Path | What it does |
|---|---|
| `cf-demo/` | Cloudflare Worker that serves the demo pages. `stage.mjs` builds the site and injects the provenance banner; media over 25 MiB streams from R2 with HTTP Range support. |
| `cf-demo/qa/` | Separate Worker used for our own QA probes against the demo. |
| `e2e/` | Playwright accessibility suite — axe-core WCAG 2.1 A/AA scans plus keyboard-operability tests, run at four viewports (320, 768, 1280, 3840 px). |
| `.github/workflows/ci.yml` | The five-job CI pipeline listed above. |
| `.github/workflows/ai-review.yml` | Optional AI review of pull requests. Disabled by default; only runs when the `AI_REVIEW_ENABLED` repository variable is `true`. |

Beyond those directories, the fork carries only changes that are already proposed upstream.

## Playback fixes in this fork

A build of upstream `develop` cannot currently play a YouTube video, and throws on 17 of
its own 60 demo pages. We found and fixed four unreleased regressions; after them, 0 of 60
throw. Each lives on a branch cut from `upstream/develop` so it can be contributed back
unchanged.

| Defect | Origin |
|---|---|
| `initSignLanguage` / `initDescription` read `sources[0]` unguarded, so any media element with no `<source>` children — every YouTube-only embed — threw and aborted player construction. The same change also made a missing attribute read as *present*, because `getAttribute()` returns `null` where `.attr()` returned `undefined`. | `834d003` |
| Every `data-youtube-*` attribute was ignored: reads asked `dataset.youTubeId`, but the real key for `data-youtube-id` is `youtubeId`. The player silently fell back to `html5` with no source. | `2d4a1c2` |
| A selector string or bare element passed to the constructor — both documented — threw on `.dataset`, because the argument was indexed directly instead of through jQuery. | `2d4a1c2` |
| `syncTrackLanguages` dereferenced `$transcriptArea` before testing `source`, so any player without a transcript threw during `initDefaultCaption`. | `05e9a22` |

Plus a guard on `getVimeoId()`, where a bare ID string — the documented `data-vimeo-id`
form — reached `new URL()` and threw.

These fixes are why [perks.locker](https://perkslocker.com) ships this fork rather than the
released version.

## Contributions to upstream

Open pull requests on `ableplayer/ableplayer`:

- [#770](https://github.com/ableplayer/ableplayer/pull/770) — fix the seven ESLint errors reported by `npm run lint`
- [#771](https://github.com/ableplayer/ableplayer/pull/771) — add GitHub Actions CI; make the puppeteer suite run headless with no local server
- [#773](https://github.com/ableplayer/ableplayer/pull/773) — add automated accessibility checks (axe-core + keyboard) for the demo pages

Three CSS branches are prepared but not yet proposed, pending the review outcome above:
`upstream/alert-color` (missing text colour on the alert box),
`upstream/control-geometry` (control button sizing and wrapping),
`upstream/theming-inheritance` (move the `--able-*` custom properties to `:root` so they
can actually be overridden by a host page).

## Reporting problems

- **A bug in Able Player itself** → file it [upstream](https://github.com/ableplayer/ableplayer/issues). That is where it gets fixed for everyone.
- **Something broken on our demo site, or in the fork-only code above** → [file it here](https://github.com/blogcastAI/ableplayer/issues).

## Licence and credit

MIT, unchanged from upstream. Able Player was created by
[Terrill Thompson](https://github.com/terrillthompson) and is maintained by
[Joe Dolson](https://github.com/joedolson). This fork claims no ownership of that work.
