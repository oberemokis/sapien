import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  showFiles: "Показать боковую панель",
  hideFiles: "Скрыть боковую панель",
  showChat: "Показать чат",
  hideChat: "Скрыть чат",
  resizeFiles: "Ширина боковой панели",
  resizeChat: "Ширина чата",
} as const;

const en: Dictionary<typeof ru> = {
  showFiles: "Show sidebar",
  hideFiles: "Hide sidebar",
  showChat: "Show chat",
  hideChat: "Hide chat",
  resizeFiles: "Sidebar width",
  resizeChat: "Chat width",
};

declare module "@sapien/i18n" {
  interface Resources {
    layout: typeof ru;
  }
}

export const dictionary = { ru, en };
