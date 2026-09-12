/**
 * RPC 兜底桥（L2 副作用边界）。
 *
 * 背景（0.1.5-rc.x 实测）：官方 connection fiber 的 inject 只剩 ["credentials"]，
 * 其 register() 内部仍访问 owner.webServer → cordis 抛 "cannot get property webServer
 * without inject"，所有插件经 connection.rpc.handle 注册的通道全部失效。
 * 兜底：自己经 webServer 注册同一 channel，按官方 wire 协议桥接，client 端零改动：
 *   请求  POST <channel>/<endpoint>  content-type: application/json
 *         体 {"type":"client-request","rpcId":string,"method":endpoint,"payload":any}
 *   回包  {"type":"server-response","rpcId":同请求,"result":<handler 返回值原样>}
 * 鉴权栅栏复用 connection.requestRejection（Host/Origin fence + 浏览器鉴权，与官方通道同源）。
 * 主通道注册成功时本函数不会被调用；官方修复后自动切回主通道。
 * 从 index.js 原样搬入（P2-B6）；ctx 只以两个窄面进入（connection.requestRejection / webServer）。
 */
import type { LogFn, WebServerFace } from '../types.ts'

export type RpcHandler = (endpoint: string, payload: unknown) => Promise<unknown> | unknown

export interface RpcBridgeCtx {
  connection?: {
    requestRejection?: (req: unknown) => number | null | undefined
  }
  webServer: WebServerFace
}

/** 读取请求体，超限即毁连（设置页 RPC 体量极小，1MB 上限仅防御异常客户端）。 */
export function readBodyBounded(req: { on(event: string, listener: (arg: never) => void): unknown; destroy(): void }, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function registerRpcFallbackBridge(
  ctx: RpcBridgeCtx,
  channel: string,
  handler: RpcHandler,
  logMsg: LogFn,
  logFail: LogFn,
): void {
  const jsonOut = (res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void }, status: number, payload: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
  const route = {
    kind: 'prefix' as const,
    path: channel,
    // req 以 unknown 进（WebServerFace 契约），桥内收窄——类型守卫集中在这一行
    handler: async (rawReq: unknown, res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: unknown): void }) => {
      const req = rawReq as { url?: string; method?: string; headers: Record<string, unknown>; destroy(): void; on(event: string, listener: (arg: never) => void): unknown }
      try {
        const rejection = ctx.connection?.requestRejection?.(req);
        if (rejection !== undefined && rejection !== null) {
          res.writeHead(rejection);
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        const pathname = String(req.url ?? '').split('?')[0];
        const endpoint = pathname.startsWith(`${channel}/`) ? pathname.slice(channel.length + 1) : '';
        const segOk = endpoint.length > 0 && endpoint.split('/').every((s) => s && s !== '.' && s !== '..');
        if (req.method !== 'POST' || !segOk) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const ct = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (ct !== 'application/json') {
          res.writeHead(415);
          res.end('content type must be application/json');
          return;
        }
        let body: unknown;
        try {
          body = JSON.parse(await readBodyBounded(req, 1024 * 1024));
        } catch {
          res.writeHead(400);
          res.end('body is not JSON');
          return;
        }
        const bodyObj = body as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown } | null;
        const validEnvelope = !!bodyObj && typeof bodyObj === 'object'
          && bodyObj.type === 'client-request'
          && typeof bodyObj.rpcId === 'string' && bodyObj.rpcId.length > 0
          && typeof bodyObj.method === 'string';
        if (!validEnvelope || bodyObj?.method !== endpoint) {
          const badId = bodyObj && typeof bodyObj.rpcId === 'string' ? bodyObj.rpcId : '';
          jsonOut(res, 200, {
            type: 'server-response',
            rpcId: badId,
            result: { ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } },
          });
          return;
        }
        try {
          const result = await handler(endpoint, bodyObj?.payload);
          jsonOut(res, 200, { type: 'server-response', rpcId: bodyObj?.rpcId as string, result });
        } catch (error) {
          res.writeHead(500);
          res.end(`handler failure: ${String(error)}`);
        }
      } catch (error) {
        try {
          res.writeHead(500);
          res.end(`bridge failure: ${String(error)}`);
        } catch { /* 响应已写出则忽略 */ }
      }
    },
  };
  try {
    ctx.webServer.register(route);
    logMsg(`[rpc] fallback bridge active: ${channel} (webServer.register, wire=client-request/server-response)`);
  } catch (error) {
    logFail(`[rpc] fallback bridge registration failed: ${error}`);
  }
}
