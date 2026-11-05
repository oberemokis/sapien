import * as i18next from "i18next";
import { initReactI18next } from "react-i18next";

// Словари по пространствам имён. Пакет со строками дополняет интерфейс
// своим русским словарём, и `t` в нём принимает только существующие ключи:
//
//   declare module "@sapien/i18n" {
//     interface Resources { agent: typeof ru }
//   }
//
// Без этого объявления `t` принимает любую строку, и опечатку никто не ловит.
export interface Resources {}

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: Resources;
  }
}

// Английский словарь объявлен формой русского: те же ключи, любые строки.
// Пропущенный или лишний ключ в переводе тоже ловит компилятор.
export type Dictionary<T> = { [K in keyof T]: T[K] extends string ? string : Dictionary<T[K]> };

type Bundles = { [N in keyof Resources]: { ru: Resources[N]; en: Dictionary<Resources[N]> } };

// Словари собирает приложение и отдаёт сюда все сразу: пространство имён,
// объявленное в Resources и забытое здесь, не компилируется. Словари лежат
// в бандле, поэтому запуск синхронный: строки готовы к первой отрисовке,
// и экран не мигает ключами. Без выбора окно на английском.
export function startI18n(bundles: Bundles) {
  const ru: Record<string, object> = {};
  const en: Record<string, object> = {};

  for (const [namespace, bundle] of Object.entries<{ ru: object; en: object }>(bundles)) {
    ru[namespace] = bundle.ru;
    en[namespace] = bundle.en;
  }

  void i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en, ru },
    initAsync: false,
    interpolation: { escapeValue: false },
  });
}
