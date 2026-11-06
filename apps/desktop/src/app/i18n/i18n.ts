import { dictionary as agents } from "@sapien/agents";
import { dictionary as appearance } from "@sapien/appearance";
import { dictionary as forge } from "@sapien/forge";
import { startI18n } from "@sapien/i18n";
import { dictionary as layout } from "@sapien/layout";
import { dictionary as projects } from "@sapien/projects";
import { dictionary as security } from "@sapien/security";
import { dictionary as sessions } from "@sapien/sessions";
import { dictionary as terminal } from "@sapien/terminal";
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
startI18n({ translation: { ru, en }, agents, appearance, forge, layout, projects, security, sessions, terminal, updates });
