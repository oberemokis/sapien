import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Language } from "../model/language";

const STORAGE_KEY = "sapien.language";

// Хранилище окна бывает закрыто политикой: тогда язык живёт до закрытия
// окна, а приложение не падает.
export function readLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Язык уже применён, без записи он только не переживёт перезапуск.
  }
}

// Язык страницы для чтения с экрана и переносов, а меню macOS строит Rust.
// В браузере без Tauri меню нет.
export function paintLanguage(language: Language) {
  document.documentElement.lang = language;

  if (isTauri()) {
    invoke("app_set_language", { language }).catch(() => {
      // Меню останется на прежнем языке, окно это не задевает.
    });
  }
}
