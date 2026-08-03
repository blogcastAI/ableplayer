// Stages the live-demo assets for the ableplayer-demo Worker.
// Run from cf-demo/ (`npm run build`) — locally or by Cloudflare Workers
// Builds with "Root directory: cf-demo".
// 1. Installs repo-root dependencies and builds the player (grunt).
// 2. Copies demos/ + build/ into public/ (test bundles excluded), which
//    wrangler.jsonc serves as the Worker's static assets.
import { execSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync } from "node:fs";
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
console.log("[stage] public/ staged: demos/ + build/ (test bundles removed)");
