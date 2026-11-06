import { dictionary as appearance } from "@sapien/appearance";
import { dictionary as forge } from "@sapien/forge";
import { startI18n } from "@sapien/i18n";
import { dictionary as layout } from "@sapien/layout";
import { dictionary as security } from "@sapien/security";
import { dictionary as updates } from "@sapien/updates";
import { en } from "./en";
import { ru } from "./ru";

// Пакеты приносят словари своими пространствами имён. Строки самого окна
// (входящие и рамка настроек) лежат здесь пространством translation.
declare module "@sapien/i18n" {
  interface Resources {
    translation: typeof ru;
  }
}

// Выбранный язык ставит пакет appearance до первой отрисовки.
startI18n({ translation: { ru, en }, appearance, forge, layout, security, updates });
