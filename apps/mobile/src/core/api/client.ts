import Constants from "expo-constants";
import { hc } from "hono/client";
import type { AppType } from "@sapien/api";

const API_PORT = 3400;

// На телефоне localhost это сам телефон. В разработке api крутится на той же
// машине, что и Metro, поэтому хост берётся у дев-сервера. В сборке без
// дев-сервера адрес обязан прийти из EXPO_PUBLIC_API_URL.
function devApiUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(":")[0] ?? "localhost";

  return `http://${host}:${API_PORT}`;
}

export const api = hc<AppType>(process.env.EXPO_PUBLIC_API_URL ?? devApiUrl());
