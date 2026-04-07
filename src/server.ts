import type { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import type { AuthResult } from "./auth";
import { createDb } from "./db";
import { rateLimit } from "./ratelimit";
import { ensureLocalToken, isLocalRequest } from "./server/middleware";
import { registerNsRoutes } from "./server/routes/ns";
import { registerPublicRoutes } from "./server/routes/public";
import { registerV1Routes } from "./server/routes/v1";

// Re-export middleware helpers used by tests and other modules
export {
  isByLegendum,
  isSelfHosted,
  setByLegendum,
} from "./server/middleware";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const LOG_DIR = join(import.meta.dir, "..", "log");
mkdirSync(LOG_DIR, { recursive: true });

function logRequest(entry: Record<string, unknown>) {
  const date = new Date().toISOString().slice(0, 10);
  appendFileSync(join(LOG_DIR, `${date}.log`), `${JSON.stringify(entry)}\n`);
}

export function createApp(db: Database) {
  ensureLocalToken(db);

  const app = new Elysia()
    // Request logging
    .derive(({ request }) => {
      return { requestStart: Date.now(), requestUrl: new URL(request.url) };
    })
    .onAfterResponse(({ request, requestStart, requestUrl, set, store }) => {
      const url = requestUrl ?? new URL(request.url);
      if (url.pathname === "/favicon.png" || url.pathname === "/logo.png")
        return;
      const a = (store as Record<string, unknown>).auth as
        | AuthResult
        | undefined;
      logRequest({
        ts: new Date().toISOString(),
        tid: a?.tokenId ?? undefined,
        method: request.method,
        path: url.pathname,
        query: url.search || undefined,
        status: set.status ?? 200,
        ms: Date.now() - (requestStart ?? Date.now()),
      });
    })

    // Rate limiting (skip for local requests)
    .onBeforeHandle(({ request, server }) => {
      if (isLocalRequest(request, server)) return;
      const forwarded = request.headers.get("X-Forwarded-For");
      const ip = forwarded
        ? forwarded.split(",")[0].trim()
        : ((
            server as { requestIP?(req: Request): { address: string } | null }
          )?.requestIP?.(request)?.address ?? "unknown");
      return rateLimit(ip) ?? undefined;
    });

  registerPublicRoutes(app);
  registerNsRoutes(app, db);
  registerV1Routes(app, db);

  return app;
}

export function createServer(db: Database, port: number = PORT) {
  const app = createApp(db);
  const instance = app.listen(port);

  return {
    port: instance.server!.port,
    stop(closeActiveConnections?: boolean) {
      instance.stop(closeActiveConnections);
    },
    app: instance,
  };
}

// Start server if run directly
if (import.meta.main) {
  const { purgeExpiredEvents } = await import("./purge");

  const args = process.argv.slice(2);
  const portIdx = args.indexOf("-p");
  const port =
    portIdx !== -1 && args[portIdx + 1]
      ? parseInt(args[portIdx + 1], 10)
      : PORT;

  const db = createDb(join(import.meta.dir, "..", "data", "depends.db"));
  const server = createServer(db, port);
  console.log(`depends.cc listening on http://localhost:${server.port}`);

  setInterval(() => purgeExpiredEvents(db), 60 * 60 * 1000);
}
