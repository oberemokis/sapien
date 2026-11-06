import { defineSetting } from "@sapien/device";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { DEFAULT_UI_SCALE, parseUiScale, type UiScale } from "../model/scale";

export const uiScaleSetting = defineSetting({
  key: "sapien.scale",
  parse: parseUiScale,
  fallback: DEFAULT_UI_SCALE,
  text: true,
});

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
