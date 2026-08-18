# Downstream integration notes — perkslocker.com (Priority Voice™)

**Read this before changing markup, class names, CSS custom properties, or
dist output in this fork.** perkslocker.com ships a build of *this* fork (not
upstream Able Player), so a change here that looks harmless can visibly break a
production creator dashboard.

- Consumer: `C:\PERKS` → `tenant-app/app/vendor/ableplayer-perks-5.1.0-<sha>.min.{js,css}`
- Vendored at fork commit **`c22a46c`** ("Rebuild dist with the four playback fixes")
- Served same-origin from a closed three-literal enum in
  `tenant-app/app/routes/assets.vendor.$file.ts` — the filename carries the
  version, and the bytes are SHA-pinned twice (committed bytes and served
  bytes). **A dist rebuild therefore requires a re-vendor + re-pin downstream;
  it is never picked up automatically.**
- Mounted by a facade IIFE in `tenant-app/app/routes/videos.tsx`: exactly one
  active player at a time, mounted into a sibling `div.video-card-player`
  after the card's anchor, torn down with `deletePlayer()` + `dispose()`.

## The contract downstream depends on

Everything below is *currently true of this fork* and is load-bearing for
PERKS. Changing any of it is a breaking change for a shipped product — bump the
dist filename and tell the downstream owner.

### 1. The `--able-*` custom-property surface

PERKS re-skins the player **entirely through custom properties**, never by
editing vendored bytes. The semantic block must keep living on `:root`
(v190 moved it there from `.able-wrapper`, and that move is what allows an
ancestor override to win at all).

Names PERKS re-points today:

```
--able-controller-background   --able-control-color        --able-control-label-color
--able-control-background      --able-seekbar-played       --able-seekbar-head
--able-seekbar-background      --able-seekbar-loaded       --able-focus-outline
--able-hover-outline           --able-big-play-background  --able-menu-background
--able-menu-color              --able-menu-border          --able-menu-focus-background
--able-menu-focus-color        --able-tooltip-background   --able-tooltip-color
--able-tooltip-border          --able-separator-color      --able-transcript-background
--able-statusbar-background    --able-statusbar-color      --able-volume-background
--able-volume-outline          --able-modal-background     --able-modal-color
--able-modal-border            --able-modal-overlay        --able-alert-background
--able-alert-button-color
```

**Renaming or dropping any of these silently reverts that surface to vendor
grey/off-white in production.** Adding new ones is safe. If a var is retired,
say so in `changelog.md` under a "downstream" heading.

### 2. Class hooks PERKS styles or queries

| Hook | Why downstream needs it |
|---|---|
| `.able-wrapper`, `.able-controller` | the glass transport capsule (radius, blur, geometry) |
| `.able-control-row` | **the element that wraps.** PERKS sets `flex-wrap: nowrap` on it above a 520px container and lets the vendor default wrap below — see §3 |
| `.able-left-controls`, `.able-right-controls` | cluster gap + nowrap |
| `.able-seekbar`, `.able-seekbar-head` | slim scrubber geometry (6px track, 14px head) |
| `.able-status-bar`, `.able-timer`, `.able-speed`, `.able-status` | restyled to console micro type; `.able-status` italic is removed |
| `.able-captions-container` | painted explicitly (PERKS sets `--able-control-background: transparent` for the big-play glyph, so this would otherwise fall through to the card) |
| `.able-modal-dialog`, `.able-modal-header`, `.able-prefs-form`, `.able-prefs-buttons`, `.able-prefs-captions`, `.modalCloseButton` | preferences dialog chrome — see §4 |
| `.able-alert` | rebranded (vendor ships `#ffc` with no text colour, unreadable on a dark console) |
| `.able-button-handler-preferences` | the facade delegates a click listener on it |
| `.able-sign-window` | reserved for the ASL window (PERKS emits `data-youtube-sign-src` only when a real sign source exists) |

### 3. Control-row wrapping is a real design axis

`.able-control-row { flex-wrap: wrap }` is correct for narrow players and wrong
for wide ones. PERKS gates it on container width. **Please keep the wrap
decision on `.able-control-row`** — moving it to the clusters
(`.able-left-controls` / `.able-right-controls`) makes the row unwrappable from
outside without `!important`, because the clusters are not the wrapping box.

Measured downstream (2026-08-18): the transport's intrinsic width is ~440px, so
an ungated `nowrap` overflows a 390px phone viewport. Any change to button
count or `--able-base-control-size` moves that number.

### 4. The preferences dialog is appended to `<body>`

`div.able-modal-dialog` is `position: fixed` and lives outside the player
subtree. That means **player-scoped CSS never reaches it** — downstream lost an
afternoon to a white system-panel dialog on a dark dashboard before finding
this. PERKS now declares `--able-modal-*` on `:root` for that reason.

If a future refactor moves the dialog inside `.able-wrapper`, that is a
*welcome* change but still a breaking one: say so explicitly in the changelog,
because downstream's `:root` re-points would then be over-broad rather than
required.

### 5. YouTube captions hide most preference fields — keep it that way

With `usingYouTubeCaptions`, the player deliberately omits font, colour,
background, opacity and position from the captions preferences, keeping only
size (which maps to `setOption('captions', 'fontSize')`). That is correct:
YouTube renders captions inside its own iframe.

Downstream now injects a plain-language sentence into `.able-prefs-captions`
explaining why only one field is present, gated on `selects.length <= 1`.
**If this fork ever restores those fields for YouTube sources, the note
disappears on its own** — no downstream change needed. Do not remove the
`.able-prefs-captions` container itself.

### 6. Fullscreen teardown

`setFullscreen` binds a **document-level** `fullscreenchange
webkitfullscreenchange` handler that neither `deletePlayer()` nor `dispose()`
unbinds. Downstream compensates by calling
`jQuery(document).off('fullscreenchange webkitfullscreenchange')` at teardown,
because a stale handler closed over a destroyed `youTubePlayer` throws and
jQuery then aborts the rest of the dispatch queue — the live player's own
resize never runs, and fullscreen renders a card-sized video pinned to the top
of a black screen (Founder-reported, 2026-07-23).

**Fixing this properly in the fork is welcome.** If teardown starts unbinding
its own handlers, note it so downstream can drop the compensation rather than
double-unbind.

### 7. Assumptions PERKS does *not* make

So you know what you are free to change: PERKS does not use the playlist,
transcript, chapters, search, VTS, or audio-description surfaces; does not rely
on `able-skin-legacy`; and does not read any `AblePlayer` instance property
other than `deletePlayer` / `dispose`.

## If you change dist

1. Rebuild and commit dist on `develop` as usual.
2. Downstream re-vendors: copy both min files under a **new** filename carrying
   the short SHA, update `PROVENANCE.md`, re-pin the hashes in
   `test/vendor-manifest.ts`, and re-run the byte gates.
3. Downstream re-runs its own player checks (transport geometry probe, grid
   a11y e2e at 320/768/1280/3840) before rolling — its CSS overrides are
   pinned to the class hooks above, not to vendor colours.

Immutable caching is keyed on the filename, so a same-name rebuild would be
served stale forever. Never rebuild in place under an existing name.
