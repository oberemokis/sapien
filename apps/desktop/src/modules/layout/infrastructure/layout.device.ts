import { isTauri } from "@tauri-apps/api/core";
import { isMac } from "@/core/ui/keys";
import type { LayoutState } from "../model/layout";

const STORAGE_KEY = "sapien.layout";

// Окно Tauri на macOS рисует свои кнопки поверх страницы: верхнюю полосу
// отдаёт ей titleBarStyle Overlay в tauri.conf.json. В браузере и на других
// системах кнопки остаются в рамке окна.
export function hasWindowButtons() {
  return isTauri() && isMac;
}

// Хранилище окна бывает закрыто политикой: тогда раскладка живёт до
// закрытия окна, а приложение не падает.
export function readLayout(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeLayout(layout: LayoutState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Раскладка уже на экране, без записи она только не переживёт перезапуск.
  }
}

export function windowWidth() {
  return window.innerWidth;
}

export function subscribeWindowWidth(onChange: () => void) {
  window.addEventListener("resize", onChange);

  return () => window.removeEventListener("resize", onChange);
}
