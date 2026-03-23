const express = require("express");
const { createProxyMiddleware, responseInterceptor } = require("http-proxy-middleware");

const app = express();

const STREAMS = {
  Devi:          "http://43.241.131.66:8081",
  Vithoba:       "http://43.241.131.66:8080",
  Bhuvaneshwari: "http://43.241.131.66:8082",
};

const STATIC_PREFIXES = ["/libs", "/js", "/css", "/img", "/socket.io"];

// ✅ Build proxies and keep references
const proxyMap = {};

for (const [name, target] of Object.entries(STREAMS)) {
  proxyMap[name] = createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    selfHandleResponse: true,
    pathRewrite: { [`^/${name}`]: "" },

    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
        const contentType = proxyRes.headers["content-type"] || "";
        if (!contentType.includes("text/html")) return responseBuffer;

        let html = responseBuffer.toString("utf8");

        STATIC_PREFIXES.forEach(prefix => {
          // src="/libs/..." → src="/Devi/libs/..."
          html = html.replace(
            new RegExp(`(src|href|action)=(["'])(${prefix})`, "g"),
            `$1=$2/${name}$3`
          );
          // url('/libs/...') → url('/Devi/libs/...')
          html = html.replace(
            new RegExp(`url\\((['"])(${prefix})`, "g"),
            `url($1/${name}$2`
          );
        });

        return html;
      }),

      error: (err, req, res) => {
        console.error(`[${name}] Proxy error:`, err.message);
        if (res?.writeHead) {
          res.writeHead(502);
          res.end(`Bad Gateway: ${name} unavailable`);
        }
      },
    },
  });
}

// ✅ Stream routes
for (const [name, proxy] of Object.entries(proxyMap)) {
  app.use(`/${name}`, proxy);
}

// ✅ Static assets — use Referer to detect stream, call proxy directly
app.use((req, res, next) => {
  const isStatic = STATIC_PREFIXES.some(p => req.url.startsWith(p));
  if (!isStatic) return next();

  const referer = req.headers["referer"] || "";
  const stream = Object.keys(STREAMS).find(s => referer.includes(`/${s}`));

  if (!stream) {
    console.warn(`[static] No stream context for: ${req.url} (referer: ${referer})`);
    return res.status(404).send("Unknown stream context");
  }

  // Rewrite URL so pathRewrite strips the stream prefix correctly
  req.url = `/${stream}${req.url}`;
  proxyMap[stream](req, res, next);
});

app.get("/", (_req, res) => res.send("✅ Proxy Running"));

// ✅ WebSocket support
const server = app.listen(process.env.PORT || 10000, () => {
  console.log(`✅ Proxy on port ${process.env.PORT || 10000}`);
});

for (const proxy of Object.values(proxyMap)) {
  server.on("upgrade", proxy.upgrade);
}