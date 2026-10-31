import { invoke } from "@tauri-apps/api/core";
import type { DataState, SecurityStatus } from "../model/security";

export function securityStatus() {
  return invoke<SecurityStatus>("security_status");
}

// Стирает нечитаемые данные приложения и заводит новый ключ. Заметки на месте.
export function securityReset() {
  return invoke<DataState>("security_reset");
}

// Touch ID, Windows Hello или пароль учётной записи системы. Отвечает,
// когда человек прошёл проверку или закрыл её.
export function appUnlock() {
  return invoke<null>("app_unlock");
}
