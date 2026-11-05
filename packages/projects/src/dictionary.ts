import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  title: "Проекты",
  add: "Добавить проект",
  addFailed: "Не удалось добавить проект или начать сессию, попробуйте ещё раз.",
  empty: "Проектов пока нет. Добавьте папку, в которой агент будет работать.",
  missing: "нет папки",
  remove: "Убрать проект",
  removeAsk: "Убрать проект из списка? Его сессии удалятся, папка на диске останется.",
  removeYes: "Убрать",
  removeNo: "Отмена",
  removeFailed: "Не удалось убрать проект. Если агент отвечает в нём, остановите ответ.",
} as const;

const en: Dictionary<typeof ru> = {
  title: "Projects",
  add: "Add project",
  addFailed: "Could not add the project or start a session, please try again.",
  empty: "No projects yet. Add a folder for the agent to work in.",
  missing: "folder missing",
  remove: "Remove project",
  removeAsk: "Remove the project from the list? Its sessions will be deleted, the folder on disk stays.",
  removeYes: "Remove",
  removeNo: "Cancel",
  removeFailed: "Could not remove the project. If the agent is responding in it, stop the response.",
};

declare module "@sapien/i18n" {
  interface Resources {
    projects: typeof ru;
  }
}

export const dictionary = { ru, en };
