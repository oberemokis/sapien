import { startI18n } from "@sapien/i18n";
import { en } from "./en";
import { ru } from "./ru";

// Словари модулей окна лежат здесь одним пространством имён, пока модули
// не стали пакетами: каждый пакет заберёт свою часть своим пространством.
declare module "@sapien/i18n" {
  interface Resources {
    translation: typeof ru;
  }
}

// Выбранный язык ставит модуль appearance до первой отрисовки.
startI18n({ translation: { ru, en } });
