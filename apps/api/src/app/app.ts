import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "#core/config/env";

// Окно Tauri грузится со своего origin, а не с адреса api: tauri://localhost на
// macOS и Linux, http://tauri.localhost на Windows. Дев-сервер Vite из
// apps/desktop пускается только вне продакшена: страница на чужом
// localhost:1420 не должна звать боевой api.
const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost"];
const DEV_ORIGIN = "http://localhost:1420";

function originsFor(env: Pick<Env, "NODE_ENV">): string[] {
  if (env.NODE_ENV === "production") {
    return TAURI_ORIGINS;
  }

  return [...TAURI_ORIGINS, DEV_ORIGIN];
}

// Маршруты идут одной цепочкой: клиент Hono RPC выводит свой тип из неё, и
// маршрут, объявленный отдельным вызовом, клиенту не виден. Модули встают в
// цепочку через .route().
export function createApp(env: Pick<Env, "NODE_ENV">) {
  return new Hono()
    .use(cors({ origin: originsFor(env) }))
    .get("/health", (c) => c.json({ status: "ok" } as const, 200));
}
