import { defineSetting } from "@sapien/device";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseLanguage, type Language } from "../model/language";

export const languageSetting = defineSetting<Language>({
  key: "sapien.language",
  parse: parseLanguage,
  fallback: "en",
  text: true,
});

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
