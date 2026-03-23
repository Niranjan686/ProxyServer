const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// 🔥 store stream in cookie
app.use((req, res, next) => {
  if (req.url.startsWith("/Devi")) {
    res.setHeader("Set-Cookie", "stream=Devi");
  } else if (req.url.startsWith("/Vithoba")) {
    res.setHeader("Set-Cookie", "stream=Vithoba");
  } else if (req.url.startsWith("/Bhuvaneshwari")) {
    res.setHeader("Set-Cookie", "stream=Bhuvaneshwari");
  }
  next();
});

// 🔥 FIX STATIC PATHS
app.use((req, res, next) => {
  if (
    req.url.startsWith("/libs") ||
    req.url.startsWith("/js") ||
    req.url.startsWith("/css") ||
    req.url.startsWith("/img") ||
    req.url.startsWith("/socket.io")
  ) {
    const cookie = req.headers.cookie || "";

    if (cookie.includes("stream=Bhuvaneshwari")) {
      req.url = "/Bhuvaneshwari" + req.url;
    } else if (cookie.includes("stream=Devi")) {
      req.url = "/Devi" + req.url;
    } else if (cookie.includes("stream=Vithoba")) {
      req.url = "/Vithoba" + req.url;
    }
  }
  next();
});

// 🔥 PROXIES (CREATE ONCE)
const deviProxy = createProxyMiddleware({
  target: "http://43.241.131.66:8081",
  changeOrigin: true,
  ws: true,
  pathRewrite: { "^/Devi": "" }
});

const vithobaProxy = createProxyMiddleware({
  target: "http://43.241.131.66:8080",
  changeOrigin: true,
  ws: true,
  pathRewrite: { "^/Vithoba": "" }
});

const bhuvanProxy = createProxyMiddleware({
  target: "http://43.241.131.66:8082",
  changeOrigin: true,
  ws: true,
  pathRewrite: { "^/Bhuvaneshwari": "" }
});

// ROUTES
app.use("/Devi", deviProxy);
app.use("/Vithoba", vithobaProxy);
app.use("/Bhuvaneshwari", bhuvanProxy);

// ROOT
app.get("/", (req, res) => {
  res.send("✅ Proxy Running FINAL");
});

app.listen(process.env.PORT || 10000);