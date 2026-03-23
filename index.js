const express = require("express");
const { createProxyMiddleware, responseInterceptor } = require("http-proxy-middleware");

const app = express();

const STREAMS = {
  Devi: {
    target: "http://43.241.131.66:8081",
    embedPath: "/61UrPpOUxPHPb9W7vaJf1RpEPxuy4h/embed/0QJSB5iAZO/laxminarayan/jquery|fullscreen|gui",
    label: "Laxmi Narayan",
  },
  Vithoba: {
    target: "http://43.241.131.66:8080",
    embedPath: "/igQfNYjeKgtRjXMBX6hdHmHA3W6oeo/embed/nALDhzrwbk/vithalrukmani/jquery|fullscreen|gui",
    label: "Vithal Rukmani",
  },
  Bhuvaneshwari: {
    target: "http://43.241.131.66:8082",
    embedPath: "/zuCYpPJQlYDtFw24aEBM5p2TboVg1N/embed/LzdXCGlmjH/bhuvaneshwari/jquery|fullscreen|gui",
    label: "Bhuvaneshwari",
  },
};

const STATIC_PREFIXES = ["/libs", "/js", "/css", "/img", "/socket.io"];

const httpProxyMap = {};
const wsProxyMap = {};

for (const [name, stream] of Object.entries(STREAMS)) {
  httpProxyMap[name] = createProxyMiddleware({
    target: stream.target,
    changeOrigin: true,
    ws: false,
    selfHandleResponse: true,
    pathRewrite: (path) => {
      if (path === `/${name}` || path === `/${name}/`) return stream.embedPath;
      return path.replace(new RegExp(`^/${name}`), "");
    },
    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
        const contentType = proxyRes.headers["content-type"] || "";
        if (!contentType.includes("text/html")) return responseBuffer;

        let html = responseBuffer.toString("utf8");

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

        html = html.replace(/io\s*\(\s*\)/g, `io({ path: "/${name}/socket.io" })`);
        html = html.replace(/io\s*\(\s*["']\/["']\s*\)/g, `io({ path: "/${name}/socket.io" })`);

        return html;
      }),
      error: (err, req, res) => {
        console.error(`[${name}][HTTP] Error:`, err.message);
        if (res?.writeHead) { res.writeHead(502); res.end(`Bad Gateway: ${name}`); }
      },
    },
  });

  wsProxyMap[name] = createProxyMiddleware({
    target: stream.target.replace("http://", "ws://"),
    changeOrigin: true,
    ws: true,
    selfHandleResponse: false,
    pathRewrite: (path) => path.replace(new RegExp(`^/${name}`), ""),
    on: {
      error: (err) => console.error(`[${name}][WS] Error:`, err.message),
    },
  });
}

// ── Stream proxy routes ──────────────────────────────────────
for (const [name, proxy] of Object.entries(httpProxyMap)) {
  app.use(`/${name}`, proxy);
}

// ── Static assets via Referer ────────────────────────────────
app.use((req, res, next) => {
  const isStatic = STATIC_PREFIXES.some(p => req.url.startsWith(p));
  if (!isStatic) return next();

  const referer = req.headers["referer"] || "";
  const stream = Object.keys(STREAMS).find(s => referer.includes(`/${s}`));
  if (!stream) return res.status(404).send("Unknown stream context");

  req.url = `/${stream}${req.url}`;
  httpProxyMap[stream](req, res, next);
});

// ── ROOT — Single page with all 3 streams as tabs ────────────
app.get("/", (_req, res) => {
  const tabs = Object.entries(STREAMS).map(([name, s]) =>
    `<button class="tab" onclick="switchTab('${name}')" id="tab-${name}">${s.label}</button>`
  ).join("");

  const iframes = Object.keys(STREAMS).map(name =>
    `<iframe id="frame-${name}" src="/${name}" class="stream-frame" style="display:none"></iframe>`
  ).join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Live Streams</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1f1f; font-family: sans-serif; height: 100vh; display: flex; flex-direction: column; }

    .tab-bar {
      display: flex;
      background: #0a1a1a;
      border-bottom: 2px solid #1a4040;
      padding: 8px 12px;
      gap: 8px;
    }

    .tab {
      padding: 8px 24px;
      border: none;
      border-radius: 6px;
      background: #1a3a3a;
      color: #aaa;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.5px;
      transition: all 0.2s;
    }

    .tab:hover { background: #1f4f4f; color: #fff; }

    .tab.active {
      background: #00c897;
      color: #000;
    }

    .stream-frame {
      flex: 1;
      width: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <div class="tab-bar">
    ${tabs}
  </div>
  ${iframes}

  <script>
    function switchTab(name) {
      // Hide all frames
      document.querySelectorAll('.stream-frame').forEach(f => f.style.display = 'none');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

      // Show selected
      document.getElementById('frame-' + name).style.display = 'block';
      document.getElementById('tab-' + name).classList.add('active');
    }

    // Load first tab by default
    switchTab('${Object.keys(STREAMS)[0]}');
  </script>
</body>
</html>`);
});

// ── Server + WebSocket ───────────────────────────────────────
const server = app.listen(process.env.PORT || 10000, () => {
  console.log(`✅ Proxy on port ${process.env.PORT || 10000}`);
});

server.on("upgrade", (req, socket, head) => {
  const urlStream = Object.keys(STREAMS).find(s => req.url.startsWith(`/${s}`));
  if (urlStream) return wsProxyMap[urlStream].upgrade(req, socket, head);

  const origin = req.headers["origin"] || req.headers["referer"] || "";
  const refStream = Object.keys(STREAMS).find(s => origin.includes(`/${s}`));
  if (refStream) {
    req.url = `/${refStream}${req.url}`;
    return wsProxyMap[refStream].upgrade(req, socket, head);
  }

  console.warn(`[WS] No stream for: ${req.url}`);
  socket.destroy();
});