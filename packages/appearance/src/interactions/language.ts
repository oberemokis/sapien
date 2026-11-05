import { changeLanguage } from "i18next";
import { useTranslation } from "react-i18next";
import { languageSetting, paintLanguage } from "../infrastructure/language.device";
import { parseLanguage, type Language } from "../model/language";

function applyLanguage(language: Language) {
  void changeLanguage(language);
  paintLanguage(language);
}

// Зовётся один раз до первой отрисовки, как тема: иначе окно мигнёт
// английским у того, кто выбрал русский.
export function restoreLanguage() {
  applyLanguage(languageSetting.read());
}

// Текущий язык держит i18next, отдельного стора нет.
export function useLanguage() {
  return parseLanguage(useTranslation().i18n.language);
}

export function setLanguage(language: Language) {
  languageSetting.write(language);
  applyLanguage(language);
}
