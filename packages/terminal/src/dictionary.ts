import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  exited: "Оболочка завершилась.",
  restart: "Открыть новую",
  failed: "Оболочка не запустилась.",
  retry: "Повторить",
  panes: {
    label: "Панель {{index}}",
    splitRight: "Разделить вправо",
    splitLeft: "Разделить влево",
    splitDown: "Разделить вниз",
    splitUp: "Разделить вверх",
    close: "Закрыть панель",
    last: "Последнюю панель закрывает вкладка",
    resize: "Граница панелей",
  },
} as const;

const en: Dictionary<typeof ru> = {
  exited: "The shell has exited.",
  restart: "Open a new one",
  failed: "The shell did not start.",
  retry: "Retry",
  panes: {
    label: "Pane {{index}}",
    splitRight: "Split right",
    splitLeft: "Split left",
    splitDown: "Split down",
    splitUp: "Split up",
    close: "Close pane",
    last: "The last pane closes with its tab",
    resize: "Pane border",
  },
};

declare module "@sapien/i18n" {
  interface Resources {
    terminal: typeof ru;
  }
}

export const dictionary = { ru, en };
