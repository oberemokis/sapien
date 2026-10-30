import { hc } from "hono/client";
import type { AppType } from "@sapien/api";

// Адрес абсолютный: окно Tauri грузится со своего origin (tauri://localhost),
// и относительный путь до api не дойдёт. Новый адрес добавляется и в
// connect-src в src-tauri/tauri.conf.json, иначе бандл его заблокирует.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3400";

export const api = hc<AppType>(API_URL);
