import i18next from "i18next";
import { useTranslation } from "react-i18next";
import { paintLanguage, readLanguage, writeLanguage } from "../infrastructure/language.device";
import { parseLanguage, type Language } from "../model/language";

function applyLanguage(language: Language) {
  void i18next.changeLanguage(language);
  paintLanguage(language);
}

// Зовётся один раз до первой отрисовки, как тема: иначе окно мигнёт
// английским у того, кто выбрал русский.
export function restoreLanguage() {
  applyLanguage(parseLanguage(readLanguage()));
}

// Текущий язык держит i18next, отдельного стора нет.
export function useLanguage() {
  return parseLanguage(useTranslation().i18n.language);
}

export function setLanguage(language: Language) {
  writeLanguage(language);
  applyLanguage(language);
}
