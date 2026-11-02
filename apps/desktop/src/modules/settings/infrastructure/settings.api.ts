import { listen } from "@tauri-apps/api/event";

// «sapien → Настройки…» в меню macOS (src-tauri/src/menu.rs).
export function onSettingsMenu(handler: () => void) {
  return listen("menu-settings", () => handler());
}
