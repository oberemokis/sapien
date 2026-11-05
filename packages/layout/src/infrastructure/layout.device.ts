import { defineSetting } from "@sapien/device";
import { isTauri } from "@tauri-apps/api/core";
import { INITIAL_LAYOUT, parseLayout } from "../model/layout";

export const layoutSetting = defineSetting({
  key: "sapien.layout",
  parse: parseLayout,
  fallback: INITIAL_LAYOUT,
});

// Окно Tauri рисует кнопки macOS поверх страницы: верхнюю полосу отдаёт ей
// titleBarStyle Overlay в tauri.conf.json. В браузере кнопок нет.
export function hasWindowButtons() {
  return isTauri();
}

export function windowWidth() {
  return window.innerWidth;
}

export function subscribeWindowWidth(onChange: () => void) {
  window.addEventListener("resize", onChange);

  return () => window.removeEventListener("resize", onChange);
}
