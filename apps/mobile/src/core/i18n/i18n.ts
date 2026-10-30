import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { ru } from "./ru";

// Без этого объявления `t` принимает любую строку, и опечатку в ключе
// никто не ловит. С ним компилятор знает ключи основного словаря.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof ru };
  }
}

// Словари лежат в бандле, поэтому запуск синхронный: строки готовы к первой
// отрисовке, и экран не мигает ключами.
void i18next.use(initReactI18next).init({
  lng: "ru",
  fallbackLng: "ru",
  resources: { ru: { translation: ru } },
  initAsync: false,
  interpolation: { escapeValue: false },
});
