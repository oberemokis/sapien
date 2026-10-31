import { invoke } from "@tauri-apps/api/core";
import type { DataState, SecurityStatus } from "../model/security";

export function securityStatus() {
  return invoke<SecurityStatus>("security_status");
}

// Стирает нечитаемые данные приложения и заводит новый ключ. Заметки на месте.
export function securityReset() {
  return invoke<DataState>("security_reset");
}
