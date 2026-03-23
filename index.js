const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 10000;

// 🔥 Track active stream
let currentTarget = "http://43.241.131.66:8081"; // default Devi

function proxy(basePath, target) {
  return createProxyMiddleware({
    target: target,
    changeOrigin: true,
    ws: true,
    secure: false,

    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader("Referer", target);
      proxyReq.setHeader("Origin", target);
    },

    pathRewrite: {
      [`^${basePath}`]: ""
    }
  });
}

// 🔥 MAIN ROUTES

app.use("/Devi", (req, res, next) => {
  currentTarget = "http://43.241.131.66:8081";
  proxy("/Devi", currentTarget)(req, res, next);
});

app.use("/Vithoba", (req, res, next) => {
  currentTarget = "http://43.241.131.66:8080";
  proxy("/Vithoba", currentTarget)(req, res, next);
});

app.use("/Bhuvaneshwari", (req, res, next) => {
  currentTarget = "http://43.241.131.66:8082";
  proxy("/Bhuvaneshwari", currentTarget)(req, res, next);
});

// 🔥 CRITICAL FIX (STATIC FILES → DYNAMIC TARGET)
app.use([
  "/libs",
  "/js",
  "/css",
  "/img",
  "/hls",
  "/socket.io"
], (req, res, next) => {
  createProxyMiddleware({
    target: currentTarget,
    changeOrigin: true,
    ws: true,
    secure: false
  })(req, res, next);
});

// ROOT
app.get("/", (req, res) => {
  res.send("✅ Proxy Running FINAL");
});

app.listen(PORT, () => {
  console.log("🚀 Running on port " + PORT);
});