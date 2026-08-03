/**
 * Able Player live demo Worker.
 *
 * - /            -> redirects to /demos/
 * - /demos/*     -> static assets (demo HTML pages, demos.css, demo-scripts)
 * - /build/*     -> static assets (compiled player JS/CSS the demos load)
 * - /media/*     -> R2 (large video/audio/caption files) with HTTP Range
 *                   support so seeking works in every browser
 *
 * The demos reference assets with relative paths ("../build/...",
 * "../media/..."), which resolve to /build/* and /media/* from /demos/* —
 * so the repo's demo pages work unmodified.
 */
interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  vtt: "text/vtt; charset=utf-8",
  srt: "text/plain; charset=utf-8",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
};

function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES[ext] ?? "application/octet-stream";
}

function baseHeaders(key: string, obj: R2Object): Headers {
  const h = new Headers();
  h.set("Content-Type", contentTypeFor(key));
  h.set("Accept-Ranges", "bytes");
  h.set("ETag", obj.httpEtag);
  h.set("Cache-Control", "public, max-age=86400");
  h.set("Access-Control-Allow-Origin", "*");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

async function serveMedia(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const rangeHeader = request.headers.get("Range");

  if (request.method === "HEAD" || !rangeHeader) {
    const obj = request.method === "HEAD" ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
    if (!obj) return new Response("Not Found", { status: 404 });
    const headers = baseHeaders(key, obj);
    headers.set("Content-Length", String(obj.size));
    const body = request.method === "HEAD" ? null : (obj as R2ObjectBody).body;
    return new Response(body, { status: 200, headers });
  }

  // Single-range requests only (multipart ranges are not worth supporting
  // for <video>/<audio>, which never send them).
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m || (m[1] === "" && m[2] === "")) {
    return new Response("Malformed Range", { status: 416 });
  }

  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not Found", { status: 404 });
  const size = head.size;

  let start: number;
  let end: number;
  if (m[1] === "") {
    // suffix range: last N bytes
    const suffix = Number(m[2]);
    if (suffix === 0) return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const obj = await env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
  if (!obj) return new Response("Not Found", { status: 404 });

  const headers = baseHeaders(key, obj);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return new Response((obj as R2ObjectBody).body, { status: 206, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return Response.redirect(`${url.origin}/demos/`, 302);
    }
    if (url.pathname === "/demos" || url.pathname === "/demos/") {
      return env.ASSETS.fetch(new Request(`${url.origin}/demos/index.html`, request));
    }

    if (url.pathname.startsWith("/media/")) {
      // R2 keys mirror the repo layout: media/<file>
      const key = decodeURIComponent(url.pathname.slice(1));
      if (key.includes("..")) return new Response("Bad Request", { status: 400 });
      return serveMedia(request, env, key);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
