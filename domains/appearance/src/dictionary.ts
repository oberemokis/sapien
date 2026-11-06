import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  title: "Внешний вид",
  description: "Как приложение выглядит на этом устройстве.",
  theme: {
    title: "Тема",
    dark: "Тёмная",
    darkHint: "Тёмный фон при любом оформлении системы.",
    light: "Светлая",
    lightHint: "Светлый фон при любом оформлении системы.",
    system: "Как в системе",
    systemHint: "Меняется вместе с оформлением системы.",
  },
  scale: {
    title: "Масштаб",
    description: "Размер текста и всего окна, как масштаб страницы в браузере.",
  },
  language: {
    title: "Язык",
    description: "Язык окна и меню приложения.",
  },
} as const;

const en: Dictionary<typeof ru> = {
  title: "Appearance",
  description: "How the app looks on this device.",
  theme: {
    title: "Theme",
    dark: "Dark",
    darkHint: "Dark background with any system appearance.",
    light: "Light",
    lightHint: "Light background with any system appearance.",
    system: "System",
    systemHint: "Follows the system appearance.",
  },
  scale: {
    title: "Zoom",
    description: "Size of the text and the whole window, like page zoom in a browser.",
  },
  language: {
    title: "Language",
    description: "Language of the window and the app menu.",
  },
};

declare module "@sapien/i18n" {
  interface Resources {
    appearance: typeof ru;
  }
}

export const dictionary = { ru, en };
