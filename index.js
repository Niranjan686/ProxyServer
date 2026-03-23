const express = require("express");
const { createProxyMiddleware, responseInterceptor } = require("http-proxy-middleware");

const app = express();

const STREAMS = {
  Devi:          "http://43.241.131.66:8081",
  Vithoba:       "http://43.241.131.66:8080",
  Bhuvaneshwari: "http://43.241.131.66:8082",
};

const STATIC_PREFIXES = ["/libs", "/js", "/css", "/img", "/socket.io"];

const httpProxyMap = {};
const wsProxyMap = {};

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

        // Fix redirect Location headers
        if (proxyRes.headers["location"]) {
          let loc = proxyRes.headers["location"];
          loc = loc.replace(target, "");
          if (!loc.startsWith(`/${name}`)) loc = `/${name}${loc}`;
          res.setHeader("location", loc);
          console.log(`[${name}] redirect → ${loc}`);
        }

        const contentType = proxyRes.headers["content-type"] || "";

        // ✅ Rewrite HLS .m3u8 manifests
        if (
          contentType.includes("application/vnd.apple.mpegurl") ||
          contentType.includes("application/x-mpegurl") ||
          contentType.includes("audio/mpegurl") ||
          req.url.includes(".m3u8")
        ) {
          let manifest = responseBuffer.toString("utf8");

          // Rewrite full URLs pointing to origin
          manifest = manifest.replace(
            new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            `/${name}`
          );

          // Rewrite root-relative paths like /token/hls/... → /Name/token/hls/...
          manifest = manifest.replace(
            /^(\/)(?!${name}\/?)([^\r\n]+)/gm,
            `/${name}/$2`
          );

          console.log(`[${name}] Rewrote .m3u8 manifest`);
          res.setHeader("content-type", "application/vnd.apple.mpegurl");
          return Buffer.from(manifest, "utf8");
        }

        if (!contentType.includes("text/html")) return responseBuffer;

        let html = responseBuffer.toString("utf8");

        // Fix static asset paths
        STATIC_PREFIXES.forEach(prefix => {
          html = html.replace(
            new RegExp(`(src|href|action)=(["'])(${prefix})`, "g"),
            `$1=$2/${name}$3`
          );
          html = html.replace(
            new RegExp(`url\\((['"])(${prefix})`, "g"),
            `url($1/${name}$2`
          );
        });

        // Fix socket.io path
        html = html.replace(
          /io\s*\(\s*\)/g,
          `io({ path: "/${name}/socket.io" })`
        );
        html = html.replace(
          /io\s*\(\s*["']\/["']\s*\)/g,
          `io({ path: "/${name}/socket.io" })`
        );

        // Fix <video> tags — add muted, autoplay, playsinline
        html = html.replace(
          /<video([^>]*)>/gi,
          (match, attrs) => {
            if (!attrs.includes("muted"))      attrs += " muted";
            if (!attrs.includes("autoplay"))   attrs += " autoplay";
            if (!attrs.includes("playsinline")) attrs += " playsinline";
            return `<video${attrs}>`;
          }
        );

        // ✅ Inject autoplay fix script before </body>
        const autoplayScript = `
<script>
(function() {
  function fixAutoplay() {
    document.querySelectorAll('video, audio').forEach(function(media) {
      if (!media._autoplayFixed) {
        media._autoplayFixed = true;
        media.muted = true;
        var p = media.play();
        if (p && p.catch) {
          p.catch(function() {});
        }

        // Unmute on first user interaction
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

  // Run immediately
  fixAutoplay();

  // Watch for dynamically added video/audio elements (HLS players add these late)
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (!node) return;
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          fixAutoplay();
        }
        if (node.querySelectorAll) {
          node.querySelectorAll('video, audio').forEach(function() {
            fixAutoplay();
          });
        }
      });
    });
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.body, { childList: true, subtree: true });
      fixAutoplay();
    });
  }
})();
</script>`;

        html = html.replace(/<\/body>/i, autoplayScript + "</body>");

        // If no </body> found, append at end
        if (!html.includes(autoplayScript)) {
          html += autoplayScript;
        }

        return html;
      }),

      error: (err, req, res) => {
        console.error(`[${name}] Error:`, err.message);
        if (res?.writeHead) { res.writeHead(502); res.end(`Bad Gateway`); }
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

// ✅ HLS/asset requests WITHOUT stream prefix — detect via Referer and reroute
app.use((req, res, next) => {
  const alreadyPrefixed = Object.keys(STREAMS).some(s =>
    req.url.toLowerCase().startsWith(`/${s.toLowerCase()}`)
  );
  if (alreadyPrefixed) return next();

  const referer = req.headers["referer"] || "";
  const stream = Object.keys(STREAMS).find(s =>
    referer.toLowerCase().includes(`/${s.toLowerCase()}`)
  );

  if (stream) {
    console.log(`[HLS-fix] ${req.url} → /${stream}${req.url} (via Referer)`);
    req.url = `/${stream}${req.url}`;
    return httpProxyMap[stream](req, res, next);
  }

  next();
});

// Stream routes
for (const [name, proxy] of Object.entries(httpProxyMap)) {
  app.use(`/${name}`, proxy);
}

// Static assets via Referer
app.use((req, res, next) => {
  const isStatic = STATIC_PREFIXES.some(p => req.url.startsWith(p));
  if (!isStatic) return next();

  const referer = req.headers["referer"] || "";
  const stream = Object.keys(STREAMS).find(s =>
    referer.toLowerCase().includes(`/${s.toLowerCase()}`)
  );
  if (!stream) return res.status(404).send("Unknown stream context");

  req.url = `/${stream}${req.url}`;
  httpProxyMap[stream](req, res, next);
});

// Home page
app.get("/", (_req, res) => {
  res.send(`
    <h2>Streams</h2>
    <ul>
      <li><a href="/Devi/61UrPpOUxPHPb9W7vaJf1RpEPxuy4h/embed/0QJSB5iAZO/laxminarayan/jquery%7Cfullscreen%7Cgui">Laxmi Narayan</a></li>
      <li><a href="/Vithoba/igQfNYjeKgtRjXMBX6hdHmHA3W6oeo/embed/nALDhzrwbk/vithalrukmani/jquery%7Cfullscreen%7Cgui">Vithal Rukmani</a></li>
      <li><a href="/Bhuvaneshwari/zuCYpPJQlYDtFw24aEBM5p2TboVg1N/embed/LzdXCGlmjH/bhuvaneshwari/jquery%7Cfullscreen%7Cgui">Bhuvaneshwari</a></li>
    </ul>
  `);
});

const server = app.listen(process.env.PORT || 10000, () => {
  console.log(`✅ Proxy running on port ${process.env.PORT || 10000}`);
  console.log(`
  Open:
  http://localhost:10000/Devi/61UrPpOUxPHPb9W7vaJf1RpEPxuy4h/embed/0QJSB5iAZO/laxminarayan/jquery%7Cfullscreen%7Cgui
  http://localhost:10000/Vithoba/igQfNYjeKgtRjXMBX6hdHmHA3W6oeo/embed/nALDhzrwbk/vithalrukmani/jquery%7Cfullscreen%7Cgui
  http://localhost:10000/Bhuvaneshwari/zuCYpPJQlYDtFw24aEBM5p2TboVg1N/embed/LzdXCGlmjH/bhuvaneshwari/jquery%7Cfullscreen%7Cgui
  `);
});

// WebSocket upgrade handling
server.on("upgrade", (req, socket, head) => {
  const urlStream = Object.keys(STREAMS).find(s =>
    req.url.toLowerCase().startsWith(`/${s.toLowerCase()}`)
  );
  if (urlStream) return wsProxyMap[urlStream].upgrade(req, socket, head);

  const origin = req.headers["origin"] || req.headers["referer"] || "";
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