#!/usr/bin/env node

import http from "node:http";

const PUBLIC_PORT = Number(process.env.PUBLIC_PORT ?? 44444);
const NEXT_PORT = Number(process.env.NEXT_PORT ?? 44446);
const SOCKET_PORT = Number(process.env.SOCKET_PORT ?? 44447);
const REST_PORT = Number(process.env.REST_PORT ?? 44448);
const BIND_HOST = process.env.BIND_HOST ?? "0.0.0.0";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forward(req, res, port, { rewritePath = null } = {}) {
  const path = rewritePath ? rewritePath(req.url ?? "/") : req.url;
  const proxyReq = http.request(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ ok: false, error: "upstream_unreachable", port, detail: err.message }),
    );
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const path = url.split("?")[0];
  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const isSocketHandshake =
    path.startsWith("/socket.io/") || /XTransformPort=44447/.test(query);

  if (isSocketHandshake) {
    const rewritten = path.startsWith("/socket.io/")
      ? url
      : `/socket.io/${query.replace(/.*XTransformPort=44447&?/, "")}`;
    forward(req, res, SOCKET_PORT, { rewritePath: () => rewritten });
    return;
  }
  if (path.startsWith("/rest/room/")) {
    forward(req, res, REST_PORT, {
      rewritePath: () => url.replace("/rest/room/", "/room/"),
    });
    return;
  }
  forward(req, res, NEXT_PORT);
});

server.on("upgrade", (req, clientSocket, head) => {
  const path = (req.url ?? "").split("?")[0];
  const isSocket = path.startsWith("/socket.io/") || /XTransformPort=44447/.test(req.url ?? "");
  const target = isSocket ? SOCKET_PORT : NEXT_PORT;
  const upstreamPath =
    isSocket && !path.startsWith("/socket.io/")
      ? `/socket.io/${(req.url ?? "").split("?")[1] ? "?" + (req.url ?? "").split("?")[1] : ""}`
      : req.url;

  const proxyReq = http.request({
    host: "127.0.0.1",
    port: target,
    method: req.method,
    path: upstreamPath,
    headers: {
      ...Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase())),
      ),
      connection: "Upgrade",
      upgrade: "websocket",
    },
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    const lines = Object.entries(proxyRes.headers)
      .filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase()))
      .map(([k, v]) => `${k}: ${v}`);
    clientSocket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (proxyHead?.length) clientSocket.unshift(proxyHead);
    clientSocket.setNoDelay(true);
    proxySocket.setNoDelay(true);
    proxySocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => proxySocket.destroy());
    proxySocket.pipe(clientSocket).pipe(proxySocket);
  });

  proxyReq.on("response", (res) => {
    res.resume();
    clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  proxyReq.on("error", () => clientSocket.destroy());
  if (head?.length) proxyReq.unshift(head);
  proxyReq.end();
});

server.listen(PUBLIC_PORT, BIND_HOST, () => {
  console.log(`[proxy] public   http://0.0.0.0:${PUBLIC_PORT}`);
  console.log(`[proxy]   /socket.io/* -> 127.0.0.1:${SOCKET_PORT}`);
  console.log(`[proxy]   /rest/room/* -> 127.0.0.1:${REST_PORT}`);
  console.log(`[proxy]   /*           -> 127.0.0.1:${NEXT_PORT}`);
});