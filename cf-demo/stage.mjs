// Stages the live-demo assets for the ableplayer-demo Worker.
// Run from cf-demo/ (`npm run build`) — locally or by Cloudflare Workers
// Builds with "Root directory: cf-demo".
// 1. Installs repo-root dependencies and builds the player (grunt).
// 2. Copies demos/ + build/ into public/ (test bundles excluded), which
//    wrangler.jsonc serves as the Worker's static assets.
// 3. Injects a provenance banner into each staged demo page. The banner
//    exists ONLY in the deployed output — demos/ in git stays byte-identical
//    to upstream — so visitors always know they are looking at a fork
//    development build, not an official AblePlayer release, and bug reports
//    come to our fork tracker instead of upstream's.
import { execSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const cfDemo = dirname(fileURLToPath(import.meta.url));
const root = join(cfDemo, "..");
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

run("npm ci", root);
run("npx grunt", root);

const pub = join(cfDemo, "public");
rmSync(pub, { recursive: true, force: true });
mkdirSync(pub, { recursive: true });
cpSync(join(root, "demos"), join(pub, "demos"), { recursive: true });
cpSync(join(root, "build"), join(pub, "build"), { recursive: true });
rmSync(join(pub, "build", "test"), { recursive: true, force: true });

// Provenance banner: version from package.json (never drifts), branch/commit
// from Workers Builds env when present (WORKERS_CI_BRANCH/COMMIT_SHA), local
// git otherwise. Static markup + inline styles only; role="note" so screen
// readers announce it as complementary content, links keep default focus
// behavior. Insertion point: immediately after the opening <body ...> tag.
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const git = (cmd) => { try { return execSync(cmd, { cwd: root }).toString().trim(); } catch { return ""; } };
const branch = process.env.WORKERS_CI_BRANCH || git("git rev-parse --abbrev-ref HEAD") || "develop";
const commit = (process.env.WORKERS_CI_COMMIT_SHA || git("git rev-parse HEAD") || "").slice(0, 7);
const banner = `\n<div role="note" style="background:#1c1917;color:#f5f5f4;padding:10px 16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;border-bottom:3px solid #f90;">
<strong>Unofficial development demo.</strong> AblePlayer v${version}${branch ? ` — <code style="color:#ffbb37;">${branch}</code>` : ""}${commit ? ` branch build <code style="color:#ffbb37;">${commit}</code>` : ""}, served from the <a href="https://github.com/blogcastAI/ableplayer" style="color:#7dd3fc;">blogcastAI/ableplayer</a> fork. Not an official AblePlayer release and not affiliated with the upstream project — for releases and documentation see <a href="https://github.com/ableplayer/ableplayer" style="color:#7dd3fc;">ableplayer/ableplayer</a>. Found a problem on this site? Report it to <a href="https://github.com/blogcastAI/ableplayer/issues" style="color:#7dd3fc;">our issue tracker</a>, not upstream.
</div>\n`;
const demoDir = join(pub, "demos");
let stamped = 0;
for (const f of readdirSync(demoDir).filter((n) => n.endsWith(".html"))) {
  const p = join(demoDir, f);
  const html = readFileSync(p, "utf8");
  const out = html.replace(/(<body[^>]*>)/i, `$1${banner}`);
  if (out !== html) { writeFileSync(p, out); stamped++; }
}
console.log(`[stage] public/ staged: demos/ + build/ (test bundles removed); provenance banner on ${stamped} pages (v${version} ${branch}@${commit})`);
