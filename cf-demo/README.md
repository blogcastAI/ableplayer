# Able Player live demo — Cloudflare Worker

Fork-local deployment (blogcastAI/ableplayer). Serves the repo's demo pages
publicly for live testing and demos.

**Live:** https://ableplayer.perkslocker.com/demos/ (also
https://ableplayer-demo.blogcast.workers.dev)

## Architecture

- `demos/` + `build/` are copied into `public/` at deploy time and served as
  Worker static assets (free, cached at edge).
- `media/` (164 MB of video/audio/captions — some files exceed the 25 MiB
  static-asset limit) lives in the `ableplayer-demo-media` R2 bucket and is
  streamed by the Worker with single-range HTTP Range support, so seeking
  works in every browser.
- Demo pages reference `../build/...` and `../media/...`, which resolve to
  `/build/*` and `/media/*` — the repo's demo HTML runs unmodified.

## Deploy

```bash
npm run build                    # from repo root: refresh build/
rm -rf cf-demo/public && mkdir -p cf-demo/public
cp -r demos cf-demo/public/demos
cp -r build cf-demo/public/build
rm -rf cf-demo/public/build/test # test bundles not needed publicly
cd cf-demo && npx wrangler deploy
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
