import { invoke } from "@tauri-apps/api/core";

// Touch ID или пароль учётной записи Mac. Отвечает,
// когда человек прошёл проверку или закрыл её.
export function appUnlock() {
  return invoke<null>("app_unlock");
}
