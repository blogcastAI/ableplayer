# Able Player live demo — Cloudflare Worker

Fork-local deployment (blogcastAI/ableplayer). Serves the repo's demo pages
publicly for live testing and demos.

**Live:** https://ableplayer.perkslocker.com/demos/ (also
https://ableplayer-demo.blogcast.workers.dev)

## Architecture

- `stage.mjs` builds the player, copies `demos/` + `build/` into `public/`,
  drops the test bundles, and injects the provenance banner into every demo
  page. The staged files are served as Worker static assets (cached at edge).
  `public/` is generated and gitignored — never commit it.
- The banner states the version, branch, and commit each page was built from,
  so the demo is never mistaken for an official Able Player release.
- `media/` (164 MB of video/audio/captions — some files exceed the 25 MiB
  static-asset limit) lives in the `ableplayer-demo-media` R2 bucket and is
  streamed by the Worker with single-range HTTP Range support, so seeking
  works in every browser.
- Demo pages reference `../build/...` and `../media/...`, which resolve to
  `/build/*` and `/media/*` — the repo's demo HTML runs unmodified.

## Deploy — automatic

Cloudflare Workers Builds is connected to `blogcastAI/ableplayer`. **A push to
`develop` that touches a watched path builds and deploys on its own** — there
is nothing to run by hand.

| Setting | Value |
|---|---|
| Branch | `develop` (trigger "Deploy default branch"); other branches build previews |
| Root directory | `/cf-demo` |
| Build command | `npm run build` (runs `stage.mjs`) |
| Deploy command | `npx wrangler deploy` |
| Build caching | enabled |
| Watched paths | `cf-demo/*`, `demos/*`, `build/*`, `styles/*`, `scripts/*`, `translations/*`, `package.json`, `package-lock.json`, `Gruntfile.cjs`, `rollup.config.js` |
| Excluded paths | `cf-demo/qa/*`, `*.md` |

**Documentation-only commits do not deploy** — `*.md` is excluded on purpose, so
editing this file or any README never burns a build. Expect the banner to keep
reporting the previous commit until a real code change lands.

Confirm a deploy landed by reading the banner on any demo page — it prints the
branch and commit actually serving. The `/ableplayer-deploy` skill has the
build-status commands and the trigger UUIDs.

### Manual fallback

Only needed if Workers Builds is unavailable:

```bash
cd cf-demo && npm run build && npx wrangler deploy
```

Media re-upload (only when media/ changes):

```bash
for f in media/*; do
  npx wrangler r2 object put "ableplayer-demo-media/media/$(basename "$f")" --file "$f" --remote
done
```

## Custom domain note

The custom domain is attached account-level (the deploy token lacks zone
Workers Routes scope, so `routes[].custom_domain` in wrangler.jsonc fails):

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"zone_id":"<ZONE_ID>","hostname":"ableplayer.perkslocker.com","service":"ableplayer-demo","environment":"production"}'
```
