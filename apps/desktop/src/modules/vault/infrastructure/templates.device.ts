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

const SEEDED_KEY = "sapien.templates.seeded";

// Какие наборы стандартных шаблонов уже клались в какие хранилища.
export function readSeeded(): unknown {
  try {
    return JSON.parse(localStorage.getItem(SEEDED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function writeSeeded(seeded: string[]) {
  try {
    localStorage.setItem(SEEDED_KEY, JSON.stringify(seeded));
  } catch {
    // Без записи набор положится снова, но только на место удалённых
    // шаблонов: правленые не перезаписываются.
  }
}
