const express = require("express");
const { createProxyMiddleware, responseInterceptor } = require("http-proxy-middleware");

const app = express();

const STREAMS = {
  Devi:          "http://43.241.131.66:8081",
  Vithoba:       "http://43.241.131.66:8080",
  Bhuvaneshwari: "http://43.241.131.66:8082",
};

const STREAM_PATHS = {
  Devi:          "/61UrPpOUxPHPb9W7vaJf1RpEPxuy4h/embed/0QJSB5iAZO/laxminarayan/jquery%7Cfullscreen%7Cgui",
  Vithoba:       "/igQfNYjeKgtRjXMBX6hdHmHA3W6oeo/embed/nALDhzrwbk/vithalrukmani/jquery%7Cfullscreen%7Cgui",
  Bhuvaneshwari: "/zuCYpPJQlYDtFw24aEBM5p2TboVg1N/embed/LzdXCGlmjH/bhuvaneshwari/jquery%7Cfullscreen%7Cgui",
};

const STREAM_LABELS = {
  Devi:          "Laxmi Narayan",
  Vithoba:       "Vithal Rukmani",
  Bhuvaneshwari: "Bhuvaneshwari",
};

const STATIC_PREFIXES = ["/libs", "/js", "/css", "/img", "/socket.io"];

function getPublicHost(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host  = req.headers["x-forwarded-host"]  || req.headers["host"] || "localhost:10000";
  return { proto, host, base: `${proto}://${host}` };
}

const httpProxyMap = {};
const wsProxyMap   = {};

for (const [name, target] of Object.entries(STREAMS)) {

  httpProxyMap[name] = createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: false,
    selfHandleResponse: true,

    pathRewrite: (path) => {
      const rewritten = path.replace(new RegExp(`^/${name}`, "i"), "");
      console.log(`[${name}] ${path} → ${rewritten}`);
      return rewritten || "/";
    },

    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {

        const { proto, host, base } = getPublicHost(req);

        // ── Fix redirect Location headers ─────────────────────────────────
        if (proxyRes.headers["location"]) {
          let loc = proxyRes.headers["location"];
          loc = loc.replace(target, "");
          loc = loc.replace(/https?:\/\/localhost:\d+/g, base);
          if (!loc.startsWith(`/${name}`)) loc = `/${name}${loc}`;
          res.setHeader("location", loc);
          console.log(`[${name}] redirect → ${loc}`);
        }

        const contentType = proxyRes.headers["content-type"] || "";

        // ── Rewrite HLS .m3u8 manifests ───────────────────────────────────
        if (
          contentType.includes("application/vnd.apple.mpegurl") ||
          contentType.includes("application/x-mpegurl") ||
          contentType.includes("audio/mpegurl") ||
          req.url.includes(".m3u8")
        ) {
          let manifest = responseBuffer.toString("utf8");

          manifest = manifest.replace(
            new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            `${base}/${name}`
          );
          manifest = manifest.replace(/https?:\/\/localhost:\d+/g, base);
          manifest = manifest.replace(/^\/(?![A-Za-z]+\/)/gm, `/${name}/`);

          console.log(`[${name}] Rewrote .m3u8 manifest`);
          res.setHeader("content-type", "application/vnd.apple.mpegurl");
          return Buffer.from(manifest, "utf8");
        }

        if (!contentType.includes("text/html")) return responseBuffer;

        let html = responseBuffer.toString("utf8");

        // ── Replace hardcoded localhost URLs ──────────────────────────────
        html = html.replace(/https?:\/\/localhost:\d+/g, base);
        html = html.replace(
          new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          `${base}/${name}`
        );

        // ── Fix static asset paths ────────────────────────────────────────
        STATIC_PREFIXES.forEach(prefix => {
          html = html.replace(
            new RegExp(`(src|href|action)=(["'])(${prefix.replace("/", "\\/")})`, "g"),
            `$1=$2/${name}$3`
          );
          html = html.replace(
            new RegExp(`url\\((['"])(${prefix.replace("/", "\\/")})`, "g"),
            `url($1/${name}$2`
          );
        });

        // ── Fix socket.io ─────────────────────────────────────────────────
        html = html.replace(/io\s*\(\s*\)/g,               `io("${base}", { path: "/${name}/socket.io" })`);
        html = html.replace(/io\s*\(\s*["']\/["']\s*\)/g,  `io("${base}", { path: "/${name}/socket.io" })`);
        html = html.replace(/io\s*\(\s*["']https?:\/\/[^"']+["']/g, `io("${base}", { path: "/${name}/socket.io" }`);
        html = html.replace(/io\s*\(\s*\{/g,               `io("${base}", {`);

        // ── Fix <video> tags ──────────────────────────────────────────────
        html = html.replace(/<video([^>]*)>/gi, (match, attrs) => {
          if (!attrs.includes("muted"))       attrs += " muted";
          if (!attrs.includes("autoplay"))    attrs += " autoplay";
          if (!attrs.includes("playsinline")) attrs += " playsinline";
          return `<video${attrs}>`;
        });

        // ── ✅ Fix viewport meta — replace or inject correct one ──────────
        // Remove any existing viewport meta that might have wrong values
        html = html.replace(
          /<meta[^>]*name=["']viewport["'][^>]*>/gi,
          ""
        );

        // ── ✅ Build the full injection block ─────────────────────────────
        const injectedHead = `
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  /* ✅ Force full-size layout — fixes zoom-out on deployed/live */
  html, body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: #000 !important;
  }
  /* Force video and player containers to fill viewport */
  video,
  .player,
  .video-container,
  .video-wrapper,
  #player,
  #video,
  #videoContainer,
  [id*="player"],
  [class*="player"],
  [class*="video"] {
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100% !important;
    position: relative !important;
    display: block !important;
  }
  /* Remove any fixed pixel dimensions that cause shrinking */
  [style*="width: 640"],
  [style*="width: 480"],
  [style*="width: 320"],
  [style*="height: 360"],
  [style*="height: 240"] {
    width: 100% !important;
    height: 100% !important;
  }
</style>
<script>
(function() {
  // ✅ Rewrite XHR URLs from localhost to real host
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string') {
      url = url.replace(/https?:\\/\\/localhost:\\d+/g, window.location.origin);
    }
    return _open.apply(this, [method, url].concat(Array.prototype.slice.call(arguments, 2)));
  };

  // ✅ Rewrite fetch() URLs from localhost to real host
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = input.replace(/https?:\\/\\/localhost:\\d+/g, window.location.origin);
    }
    return _fetch.call(this, input, init);
  };

  // ✅ Autoplay fix — mute first, unmute on interaction
  function fixAutoplay() {
    document.querySelectorAll('video, audio').forEach(function(media) {
      if (!media._autoplayFixed) {
        media._autoplayFixed = true;
        media.muted = true;
        var p = media.play();
        if (p && p.catch) p.catch(function() {});

        var unmute = function() {
          media.muted = false;
          document.removeEventListener('click', unmute);
          document.removeEventListener('keydown', unmute);
          document.removeEventListener('touchstart', unmute);
        };
        document.addEventListener('click', unmute);
        document.addEventListener('keydown', unmute);
        document.addEventListener('touchstart', unmute);
      }
    });
  }

  // ✅ Fix zoom — force all fixed-pixel sized elements to 100%
  function fixLayout() {
    document.querySelectorAll('*').forEach(function(el) {
      var style = el.getAttribute('style') || '';
      // Replace inline width/height pixel values that cause shrinking
      if (/width\s*:\s*\d+(px)?/.test(style) || /height\s*:\s*\d+(px)?/.test(style)) {
        var tag = el.tagName.toLowerCase();
        if (['video','div','section','main','article','body','html'].includes(tag)) {
          el.style.width  = '100%';
          el.style.height = '100%';
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    fixAutoplay();
    fixLayout();
  });

  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (!node || !node.tagName) return;
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') fixAutoplay();
        if (node.querySelectorAll) {
          node.querySelectorAll('video, audio').forEach(function() { fixAutoplay(); });
        }
      });
    });
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
})();
</script>`;

        // ── Inject right after <head> — before any other styles load ──────
        if (html.includes("<head>")) {
          html = html.replace("<head>", "<head>" + injectedHead);
        } else if (/<head\s[^>]*>/i.test(html)) {
          html = html.replace(/<head\s[^>]*>/i, (m) => m + injectedHead);
        } else if (html.includes("<body")) {
          html = html.replace(/<body[^>]*>/i, (m) => m + injectedHead);
        } else {
          html = injectedHead + html;
        }

        return html;
      }),

      error: (err, req, res) => {
        console.error(`[${name}] Error:`, err.message);
        if (res?.writeHead) { res.writeHead(502); res.end("Bad Gateway"); }
      },
    },
  });

  wsProxyMap[name] = createProxyMiddleware({
    target: target.replace("http://", "ws://"),
    changeOrigin: true,
    ws: true,
    selfHandleResponse: false,
    pathRewrite: (path) => path.replace(new RegExp(`^/${name}`, "i"), "") || "/",
    on: {
      error: (err) => console.error(`[${name}][WS] Error:`, err.message),
    },
  });
}

// ── HLS/asset requests WITHOUT stream prefix — detect via Referer ─────────────
app.use((req, res, next) => {
  const alreadyPrefixed = Object.keys(STREAMS).some(s =>
    req.url.toLowerCase().startsWith(`/${s.toLowerCase()}`)
  );
  if (alreadyPrefixed) return next();

  const referer = req.headers["referer"] || "";
  const stream  = Object.keys(STREAMS).find(s =>
    referer.toLowerCase().includes(`/${s.toLowerCase()}`)
  );

  if (stream) {
    console.log(`[HLS-fix] ${req.url} → /${stream}${req.url} (via Referer)`);
    req.url = `/${stream}${req.url}`;
    return httpProxyMap[stream](req, res, next);
  }

  next();
});

// ── Stream routes ─────────────────────────────────────────────────────────────
for (const [name, proxy] of Object.entries(httpProxyMap)) {
  app.use(`/${name}`, proxy);
}

// ── Static assets via Referer ─────────────────────────────────────────────────
app.use((req, res, next) => {
  const isStatic = STATIC_PREFIXES.some(p => req.url.startsWith(p));
  if (!isStatic) return next();

  const referer = req.headers["referer"] || "";
  const stream  = Object.keys(STREAMS).find(s =>
    referer.toLowerCase().includes(`/${s.toLowerCase()}`)
  );
  if (!stream) return res.status(404).send("Unknown stream context");

  req.url = `/${stream}${req.url}`;
  httpProxyMap[stream](req, res, next);
});

// ── Home page ─────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const { base } = getPublicHost(req);

  const links = Object.entries(STREAM_PATHS)
    .map(([name, path]) => `
      <li>
        <a href="${base}/${name}${path}">${STREAM_LABELS[name]}</a>
        <br/><small style="color:#888">${base}/${name}${path}</small>
      </li>`)
    .join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Streams</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    ul { list-style: none; padding: 0; }
    li { margin: 16px 0; padding: 16px; border: 1px solid #ddd; border-radius: 8px; }
    a { font-size: 18px; font-weight: bold; color: #0070f3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    small { font-size: 12px; word-break: break-all; }
    .info { background:#f5f5f5; padding:12px; border-radius:6px; margin-top:24px; font-size:13px; }
  </style>
</head>
<body>
  <h2>🔴 Live Streams</h2>
  <ul>${links}</ul>
  <div class="info">
    <strong>Server Info</strong><br/>
    Base URL: <code>${base}</code><br/>
    Port: <code>${process.env.PORT || 10000}</code><br/>
    Env: <code>${process.env.NODE_ENV || "development"}</code>
  </div>
</body>
</html>`);
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => {
  console.log(`✅ Proxy running on port ${PORT}`);
  console.log(`   Streams: ${Object.keys(STREAMS).join(", ")}`);
});

// ── WebSocket upgrade ─────────────────────────────────────────────────────────
server.on("upgrade", (req, socket, head) => {
  const urlStream = Object.keys(STREAMS).find(s =>
    req.url.toLowerCase().startsWith(`/${s.toLowerCase()}`)
  );
  if (urlStream) return wsProxyMap[urlStream].upgrade(req, socket, head);

  const origin    = req.headers["origin"] || req.headers["referer"] || "";
  const refStream = Object.keys(STREAMS).find(s =>
    origin.toLowerCase().includes(`/${s.toLowerCase()}`)
  );
  if (refStream) {
    req.url = `/${refStream}${req.url}`;
    return wsProxyMap[refStream].upgrade(req, socket, head);
  }

  console.warn(`[WS] No stream found for: ${req.url}`);
  socket.destroy();
});