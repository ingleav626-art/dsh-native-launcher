// src/host/io/rpcBridge.ts
function readBodyBounded(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function registerRpcFallbackBridge(ctx, channel, handler, logMsg, logFail) {
  const jsonOut = (res, status, payload) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  };
  const route = {
    kind: "prefix",
    path: channel,
    // req 以 unknown 进（WebServerFace 契约），桥内收窄——类型守卫集中在这一行
    handler: async (rawReq, res) => {
      const req = rawReq;
      try {
        const rejection = ctx.connection?.requestRejection?.(req);
        if (rejection !== void 0 && rejection !== null) {
          res.writeHead(rejection);
          res.end(rejection === 401 ? "unauthorized" : "forbidden");
          return;
        }
        const pathname = String(req.url ?? "").split("?")[0];
        const endpoint = pathname.startsWith(`${channel}/`) ? pathname.slice(channel.length + 1) : "";
        const segOk = endpoint.length > 0 && endpoint.split("/").every((s) => s && s !== "." && s !== "..");
        if (req.method !== "POST" || !segOk) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const ct = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (ct !== "application/json") {
          res.writeHead(415);
          res.end("content type must be application/json");
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBodyBounded(req, 1024 * 1024));
        } catch {
          res.writeHead(400);
          res.end("body is not JSON");
          return;
        }
        const bodyObj = body;
        const validEnvelope = !!bodyObj && typeof bodyObj === "object" && bodyObj.type === "client-request" && typeof bodyObj.rpcId === "string" && bodyObj.rpcId.length > 0 && typeof bodyObj.method === "string";
        if (!validEnvelope || bodyObj?.method !== endpoint) {
          const badId = bodyObj && typeof bodyObj.rpcId === "string" ? bodyObj.rpcId : "";
          jsonOut(res, 200, {
            type: "server-response",
            rpcId: badId,
            result: { ok: false, error: { code: "gateway/bad-request", message: "invalid client-request message", details: {} } }
          });
          return;
        }
        try {
          const result = await handler(endpoint, bodyObj?.payload);
          jsonOut(res, 200, { type: "server-response", rpcId: bodyObj?.rpcId, result });
        } catch (error) {
          res.writeHead(500);
          res.end(`handler failure: ${String(error)}`);
        }
      } catch (error) {
        try {
          res.writeHead(500);
          res.end(`bridge failure: ${String(error)}`);
        } catch {
        }
      }
    }
  };
  try {
    ctx.webServer.register(route);
    logMsg(`[rpc] fallback bridge active: ${channel} (webServer.register, wire=client-request/server-response)`);
  } catch (error) {
    logFail(`[rpc] fallback bridge registration failed: ${error}`);
  }
}
export {
  readBodyBounded,
  registerRpcFallbackBridge
};
