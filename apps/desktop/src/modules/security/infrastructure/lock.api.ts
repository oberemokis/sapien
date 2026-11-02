import { invoke } from "@tauri-apps/api/core";

// Touch ID, Windows Hello или пароль учётной записи системы. Отвечает,
// когда человек прошёл проверку или закрыл её.
export function appUnlock() {
  return invoke<null>("app_unlock");
}
