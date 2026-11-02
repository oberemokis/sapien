import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const DEV_ORIGIN = "http://localhost:1420";

function allowedOrigin(response: Response): string | null {
  return response.headers.get("access-control-allow-origin");
}

describe("api", () => {
  it("отвечает на проверку живости", async () => {
    const client = testClient(createApp({ NODE_ENV: "production" }));

    const response = await client.health.$get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("пускает окно Tauri", async () => {
    const client = testClient(createApp({ NODE_ENV: "production" }));

    const response = await client.health.$get(undefined, {
      headers: { origin: "tauri://localhost" },
    });

    expect(allowedOrigin(response)).toBe("tauri://localhost");
  });

  it("пускает дев-сервер Vite вне продакшена", async () => {
    const client = testClient(createApp({ NODE_ENV: "development" }));

    const response = await client.health.$get(undefined, {
      headers: { origin: DEV_ORIGIN },
    });

    expect(allowedOrigin(response)).toBe(DEV_ORIGIN);
  });

  it("не пускает дев-сервер Vite в продакшене", async () => {
    const client = testClient(createApp({ NODE_ENV: "production" }));

    const response = await client.health.$get(undefined, {
      headers: { origin: DEV_ORIGIN },
    });

    expect(allowedOrigin(response)).toBeNull();
  });
});
