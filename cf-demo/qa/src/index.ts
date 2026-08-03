/**
 * Able Player QA Worker.
 *
 * Three evidence lanes over https://ableplayer.perkslocker.com:
 *
 *  1. /run/screenshots — Browser Rendering: 4-viewport screenshot battery
 *     over representative demo pages (mobile 320, tablet 768, desktop 1280,
 *     4K 3840 — mirrors the perks.locker a11y harness widths).
 *  2. /run/smoke — Browser Rendering interaction tests: click-to-play,
 *     captions toggle, keyboard navigation on the video demo.
 *  3. /run/vtt-qa — Workers AI: caption-quality review of the demo VTT
 *     corpus stored in R2.
 *
 * Evidence lands in R2 under qa/<runId>/... ; GET /evidence lists runs,
 * GET /evidence/<key> serves an artifact. Run endpoints require the
 * QA_RUN_KEY secret (x-qa-key header); evidence reads are public.
 * The nightly cron runs screenshots + smoke + vtt-qa.
 */
import puppeteer from "@cloudflare/puppeteer";

interface Env {
  BROWSER: Fetcher;
  AI: Ai;
  MEDIA: R2Bucket;
  QA_RUN_KEY?: string;
}

const SITE = "https://ableplayer.perkslocker.com";

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 568 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "uhd-3840", width: 3840, height: 2160 },
] as const;

// Representative demo pages: core video, audio, second video config,
// sign-language window (external4), YouTube tech.
const PAGES = ["video1", "audio1", "video2", "external4", "youtube1"] as const;

// VTT files reviewed by the AI lane (English captions/descriptions).
const VTT_KEYS = [
  "media/wwa_captions_en.vtt",
  "media/blocks4all_captions_en.vtt",
  "media/blocks4all_descriptions_en.vtt",
] as const;

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function put(env: Env, key: string, body: string | ArrayBuffer | Uint8Array, contentType: string) {
  await env.MEDIA.put(`qa/${key}`, body, { httpMetadata: { contentType } });
}

/* ---------------- Lane 1: screenshot battery ---------------- */

async function runScreenshots(env: Env, id: string): Promise<Record<string, string>> {
  const browser = await puppeteer.launch(env.BROWSER);
  const results: Record<string, string> = {};
  try {
    for (const pageName of PAGES) {
      // Per-page isolation: one bad page must not abort the rest of the lane.
      try {
        const page = await browser.newPage();
        try {
          for (const vp of VIEWPORTS) {
            await page.setViewport({ width: vp.width, height: vp.height });
            const resp = await page.goto(`${SITE}/demos/${pageName}.html`, {
              waitUntil: "networkidle0",
              timeout: 30_000,
            });
            const status = resp?.status() ?? 0;
            const shot = (await page.screenshot({ fullPage: false })) as Uint8Array;
            const key = `${id}/screenshots/${pageName}/${vp.name}.png`;
            await put(env, key, shot, "image/png");
            results[`${pageName}/${vp.name}`] = `status:${status} bytes:${shot.byteLength}`;
          }
        } finally {
          await page.close();
        }
      } catch (err) {
        results[`${pageName}/ERROR`] = String(err).slice(0, 200);
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

/* ---------------- Lane 2: interaction smoke ---------------- */

interface SmokeCheck {
  name: string;
  pass: boolean;
  detail: string;
}

async function runSmoke(env: Env, id: string): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${SITE}/demos/video1.html`, { waitUntil: "networkidle0", timeout: 30_000 });

    // Player instantiated: transport bar present (selectors from
    // scripts/buildplayer.js — .able-controller, .able-button-handler-*).
    const controller = await page.$(".able-controller");
    checks.push({
      name: "player-instantiated",
      pass: controller !== null,
      detail: controller ? ".able-controller rendered" : ".able-controller MISSING",
    });

    // Click-to-play: press the play button, poll the <video> element.
    const playBtn = await page.$(".able-button-handler-play");
    if (playBtn) {
      await playBtn.click();
      let playing = false;
      let detail = "";
      for (let i = 0; i < 20 && !playing; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const state = await page.evaluate(() => {
          const v = document.querySelector("video");
          return v ? { paused: v.paused, t: v.currentTime, ready: v.readyState } : null;
        });
        detail = JSON.stringify(state);
        playing = !!state && !state.paused && state.t > 0;
      }
      checks.push({ name: "click-to-play", pass: playing, detail });
      // pause again to stop the session cleanly
      await page.evaluate(() => document.querySelector("video")?.pause());
    } else {
      checks.push({ name: "click-to-play", pass: false, detail: ".able-button-handler-play MISSING" });
    }

    // Captions toggle. With a single caption track the button is an
    // aria-pressed toggle (control.js handleCaptionToggle); with multiple
    // tracks it opens an .able-popup-captions menu. Accept either flip.
    const ccState = () =>
      page.evaluate(() => {
        // The handler class may sit on the <button> itself or on a wrapper
        // div around it; aria-pressed lives on the button element.
        const host = document.querySelector(".able-button-handler-captions");
        const btn = host?.matches("button") ? host : host?.querySelector("button") ?? host;
        const popup = document.querySelector(".able-popup-captions, .able-popup");
        // Single-track toggle hides exactly .able-captions-wrapper
        // (track.js creates it; caption.js show()/hide()s it). Do NOT probe
        // its always-visible ancestors (.able-vidcap-container) — a
        // selector list matches the ancestor first in document order and
        // the flip becomes invisible.
        const wrap = document.querySelector(".able-captions-wrapper");
        return {
          pressed: btn?.getAttribute("aria-pressed") ?? "none",
          popupVisible: popup ? getComputedStyle(popup).display !== "none" : false,
          captionsVisible: wrap ? getComputedStyle(wrap).display !== "none" : false,
        };
      });
    const ccPresent = await page.evaluate(() => !!document.querySelector(".able-button-handler-captions"));
    if (ccPresent) {
      const before = await ccState();
      // Click the real <button> in-page so wrapper-vs-button ambiguity and
      // pointer occlusion can't swallow the click.
      await page.evaluate(() => {
        const host = document.querySelector(".able-button-handler-captions");
        const btn = (host?.matches("button") ? host : host?.querySelector("button") ?? host) as HTMLElement | null;
        btn?.click();
      });
      // Poll up to 3s for any observable flip.
      let after = before;
      let flipped = false;
      for (let i = 0; i < 6 && !flipped; i++) {
        await new Promise((r) => setTimeout(r, 500));
        after = await ccState();
        flipped =
          after.pressed !== before.pressed ||
          after.popupVisible !== before.popupVisible ||
          after.captionsVisible !== before.captionsVisible;
      }
      checks.push({
        name: "captions-toggle",
        pass: flipped,
        detail: `before:${JSON.stringify(before)} after:${JSON.stringify(after)}`,
      });
    } else {
      checks.push({ name: "captions-toggle", pass: false, detail: ".able-button-handler-captions MISSING" });
    }

    // Keyboard nav: Tab reaches a transport control; player exposes focus.
    await page.keyboard.press("Tab");
    let reached = false;
    let hops = 0;
    for (; hops < 40 && !reached; hops++) {
      reached = await page.evaluate(() => {
        const el = document.activeElement;
        return !!el?.closest(".able-controller, .able-player");
      });
      if (!reached) await page.keyboard.press("Tab");
    }
    checks.push({
      name: "keyboard-reaches-player",
      pass: reached,
      detail: reached ? `focus entered player after ${hops + 1} Tab(s)` : "never reached player in 40 Tabs",
    });

    await page.close();
  } finally {
    await browser.close();
  }
  await put(env, `${id}/smoke.json`, JSON.stringify(checks, null, 2), "application/json");
  return checks;
}

/* ---------------- Lane 3: Workers AI VTT QA ---------------- */

const VTT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

async function runVttQa(env: Env, id: string): Promise<Record<string, unknown>> {
  const verdicts: Record<string, unknown> = {};
  for (const key of VTT_KEYS) {
    const obj = await env.MEDIA.get(key);
    if (!obj) {
      verdicts[key] = { error: "missing in R2" };
      continue;
    }
    const full = await obj.text();
    // Truncate on a cue boundary (blank line) so the model never sees a
    // half-cut cue, and record that truncation happened so a "pass" on a
    // large file is never mistaken for a full-file verdict.
    let vtt = full;
    let truncated = false;
    if (full.length > 12_000) {
      const cut = full.lastIndexOf("\n\n", 12_000);
      vtt = full.slice(0, cut > 0 ? cut : 12_000);
      truncated = true;
    }
    const result = (await env.AI.run(VTT_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are a captioning-quality reviewer following WCAG and DCMP captioning guidance. " +
            "Review the WebVTT below. Report as terse JSON with keys: " +
            "timing_issues (overlapping or out-of-order cues), formatting_issues " +
            "(line length >32 chars/line where noted, >2 lines per cue, missing speaker IDs in multi-speaker content), " +
            "quality_notes (spelling, [sound] notation consistency), overall (pass|warn|fail). " +
            "Judge only what is in the file. If clean, say so.",
        },
        { role: "user", content: vtt },
      ],
      max_tokens: 600,
    })) as { response?: string };
    verdicts[key] = {
      model: VTT_MODEL,
      review: result.response ?? "",
      truncated,
      reviewedChars: vtt.length,
      totalChars: full.length,
    };
  }
  await put(env, `${id}/vtt-qa.json`, JSON.stringify(verdicts, null, 2), "application/json");
  return verdicts;
}

/* ---------------- HTTP + cron plumbing ---------------- */

function authorized(request: Request, env: Env): boolean {
  return !!env.QA_RUN_KEY && request.headers.get("x-qa-key") === env.QA_RUN_KEY;
}

async function fullRun(env: Env): Promise<string> {
  const id = runId();
  // Lane isolation: a transient failure in one lane must not prevent the
  // other lanes from running or the summary from being written — a cron
  // night with one flaky lane should still leave a discoverable verdict.
  const errors: Record<string, string> = {};
  let screenshots: Record<string, string> = {};
  let smoke: SmokeCheck[] = [];
  let vtt: Record<string, unknown> = {};
  try {
    screenshots = await runScreenshots(env, id);
  } catch (err) {
    errors.screenshots = String(err).slice(0, 300);
  }
  try {
    smoke = await runSmoke(env, id);
  } catch (err) {
    errors.smoke = String(err).slice(0, 300);
  }
  try {
    vtt = await runVttQa(env, id);
  } catch (err) {
    errors.vttQa = String(err).slice(0, 300);
  }
  const summary = {
    runId: id,
    site: SITE,
    screenshots,
    smoke,
    vttQa: vtt,
    smokeAllPass: smoke.length > 0 && smoke.every((c) => c.pass),
    laneErrors: Object.keys(errors).length ? errors : undefined,
  };
  await put(env, `${id}/summary.json`, JSON.stringify(summary, null, 2), "application/json");
  return id;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" ) {
      return Response.json({
        service: "ableplayer-qa",
        endpoints: {
          "POST /run/full": "screenshots + smoke + vtt-qa (x-qa-key required)",
          "POST /run/screenshots": "4-viewport battery (x-qa-key required)",
          "POST /run/smoke": "player interaction checks (x-qa-key required)",
          "POST /run/vtt-qa": "AI caption review (x-qa-key required)",
          "GET /evidence": "list QA runs",
          "GET /evidence/<key>": "fetch an artifact",
        },
      });
    }

    if (url.pathname.startsWith("/run/")) {
      if (request.method !== "POST") return new Response("POST only", { status: 405 });
      if (!authorized(request, env)) return new Response("Forbidden", { status: 403 });
      const id = runId();
      switch (url.pathname) {
        case "/run/full":
          return Response.json({ runId: await fullRun(env) });
        case "/run/screenshots":
          return Response.json({ runId: id, results: await runScreenshots(env, id) });
        case "/run/smoke":
          return Response.json({ runId: id, checks: await runSmoke(env, id) });
        case "/run/vtt-qa":
          return Response.json({ runId: id, verdicts: await runVttQa(env, id) });
        default:
          return new Response("Unknown run lane", { status: 404 });
      }
    }

    if (url.pathname === "/evidence" || url.pathname === "/evidence/") {
      const list = await env.MEDIA.list({ prefix: "qa/", delimiter: "/" });
      // R2 delimitedPrefixes include the "qa/" prefix; strip it so the
      // returned run ids compose directly with /evidence/<runId>/...
      const runs = list.delimitedPrefixes.map((p) => p.replace(/^qa\//, "").replace(/\/$/, ""));
      return Response.json({
        runs,
        note: "GET /evidence/<runId>/summary.json for a run's verdict",
      });
    }
    if (url.pathname.startsWith("/evidence/")) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(url.pathname.slice("/evidence/".length));
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      const key = `qa/${decoded}`;
      if (key.includes("..")) return new Response("Bad Request", { status: 400 });
      const obj = await env.MEDIA.get(key);
      if (!obj) return new Response("Not Found", { status: 404 });
      const h = new Headers();
      h.set("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
      h.set("Cache-Control", "public, max-age=300");
      return new Response(obj.body, { headers: h });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(fullRun(env));
  },
} satisfies ExportedHandler<Env>;
