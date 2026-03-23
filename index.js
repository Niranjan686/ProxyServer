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

    // ✅ Just strip /Devi prefix — nothing else
    pathRewrite: (path) => {
      const rewritten = path.replace(new RegExp(`^/${name}`, "i"), "");
      console.log(`[${name}] ${path} → ${rewritten}`);
      return rewritten || "/";
    },

    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {

        // ✅ Fix redirect Location headers
        if (proxyRes.headers["location"]) {
          let loc = proxyRes.headers["location"];
          loc = loc.replace(target, "");
          if (!loc.startsWith(`/${name}`)) loc = `/${name}${loc}`;
          res.setHeader("location", loc);
          console.log(`[${name}] redirect → ${loc}`);
        }

        const contentType = proxyRes.headers["content-type"] || "";
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
  console.log(`✅ Proxy on port ${process.env.PORT || 10000}`);
  console.log(`
  Open:
  http://localhost:10000/Devi/61UrPpOUxPHPb9W7vaJf1RpEPxuy4h/embed/0QJSB5iAZO/laxminarayan/jquery%7Cfullscreen%7Cgui
  http://localhost:10000/Vithoba/igQfNYjeKgtRjXMBX6hdHmHA3W6oeo/embed/nALDhzrwbk/vithalrukmani/jquery%7Cfullscreen%7Cgui
  http://localhost:10000/Bhuvaneshwari/zuCYpPJQlYDtFw24aEBM5p2TboVg1N/embed/LzdXCGlmjH/bhuvaneshwari/jquery%7Cfullscreen%7Cgui
  `);
});

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

  console.warn(`[WS] No stream for: ${req.url}`);
  socket.destroy();
});
