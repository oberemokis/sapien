import { Channel, invoke } from "@tauri-apps/api/core";
import type { Update, UpdateProgress } from "../model/update";

export function appVersion() {
  return invoke<string>("app_version");
}

// Новой версии нет: null.
export function updateCheck() {
  return invoke<Update | null>("app_update_check");
}

// Ставит то, что нашла последняя проверка, и перезапускает приложение:
// при удаче обещание не кончается.
export function updateInstall(onEvent: (event: UpdateProgress) => void) {
  return invoke<null>("app_update_install", { onEvent: new Channel<UpdateProgress>(onEvent) });
}
