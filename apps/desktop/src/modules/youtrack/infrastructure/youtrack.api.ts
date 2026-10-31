import { invoke } from "@tauri-apps/api/core";
import type { YoutrackStatus } from "../model/youtrack";

// Rust спрашивает сервер, кто владелец токена: ответ говорит, работает ли
// подключение прямо сейчас.
export function youtrackStatus() {
  return invoke<YoutrackStatus>("youtrack_status");
}

// Адрес и токен сохраняются, только если YouTrack по адресу принял токен.
export function youtrackConnect(host: string, token: string) {
  return invoke<YoutrackStatus>("youtrack_connect", { host, token });
}

// Стирает токен с устройства и забывает адрес.
export function youtrackDisconnect() {
  return invoke<null>("youtrack_disconnect");
}
