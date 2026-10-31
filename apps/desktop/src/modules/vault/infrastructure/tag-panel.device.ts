import type { TagPanel } from "../model/tags";

const STORAGE_KEY = "sapien.tags.panel";

// Вид панели это настройка устройства, как ширина панелей. Хранилище окна
// бывает закрыто политикой: тогда панель развёрнута, приложение не падает.
export function readTagPanel(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeTagPanel(panel: TagPanel) {
  try {
    localStorage.setItem(STORAGE_KEY, panel);
  } catch {
    // Выбор работает до закрытия окна, только не переживёт перезапуск.
  }
}
