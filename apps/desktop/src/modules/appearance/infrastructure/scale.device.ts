import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UiScale } from "../model/scale";

const STORAGE_KEY = "sapien.scale";

// Хранилище окна бывает закрыто политикой: тогда масштаб живёт до закрытия
// окна, а приложение не падает.
export function readUiScale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeUiScale(scale: UiScale) {
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // Масштаб уже применён, без записи он только не переживёт перезапуск.
  }
}

// Масштабирует сам webview, как ⌘+ в браузере: CSS zoom в WebKit сбивает
// координаты мыши, и ручки панелей тянулись бы мимо курсора. --ui-scale
// нужен тому, что должно остаться в настоящих пикселях, например месту
// под кнопки окна macOS. В браузере без Tauri масштаб не меняется.
export function paintUiScale(scale: UiScale) {
  const factor = scale / 100;

  document.documentElement.style.setProperty("--ui-scale", String(factor));

  if (isTauri()) {
    getCurrentWebview()
      .setZoom(factor)
      .catch(() => {
        // Без масштаба окно остаётся в 100%, работать это не мешает.
      });
  }
}
