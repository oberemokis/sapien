import { invoke } from "@tauri-apps/api/core";
import type { Forge, ForgeStatus, ForgeStatuses } from "../model/forge";

export function forgeStatus() {
  return invoke<ForgeStatuses>("forge_status");
}

// Токен уходит в Rust и дальше только в системное хранилище паролей.
// host нужен GitLab на своём сервере, без него gitlab.com.
export function forgeConnect(forge: Forge, host: string | null, token: string) {
  return invoke<ForgeStatus>("forge_connect", { forge, host, token });
}

export function forgeDisconnect(forge: Forge) {
  return invoke<null>("forge_disconnect", { forge });
}
