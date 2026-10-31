import type { TemplateSettings } from "../model/templates";

const STORAGE_KEY = "sapien.templates";

// Хранилище окна бывает закрыто политикой: тогда действуют настройки
// по умолчанию, а приложение не падает.
export function readTemplateSettings(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeTemplateSettings(settings: TemplateSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Настройки уже в окне, без записи они только не переживут перезапуск.
  }
}
