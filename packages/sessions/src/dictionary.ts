import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  session: {
    projectMissing: "Папки проекта больше нет на диске: {{path}}. Терминал открывается в ней, сессия продолжится, когда папка вернётся.",
  },
  sessions: {
    sections: "Разделы",
    title: "Сессии",
    new: "Новая сессия",
    untitled: "Новая сессия",
    running: "агент работает",
    agents: "Агенты сессии «{{title}}»",
    collapse: "Свернуть агентов сессии «{{title}}»",
    expand: "Развернуть агентов сессии «{{title}}»",
    delete: "Удалить сессию",
    rename: "Переименовать",
    name: "Имя сессии",
    newFailed: "Сессия не создалась.",
    deleteFailed: "Сессия не удалилась.",
    renameFailed: "Имя не сохранилось.",
  },
  tabs: {
    label: "Вкладки проекта «{{project}}»",
    new: "Новая сессия в «{{project}}»",
    close: "Закрыть вкладку «{{title}}»",
    closeItem: "Закрыть вкладку",
    rename: "Переименовать",
    name: "Имя вкладки",
    renameFailed: "Имя не сохранилось.",
    pin: "Закрепить",
    unpin: "Открепить",
    pinned: "закреплена",
  },
  search: {
    open: "Поиск",
    title: "Поиск сессии",
    placeholder: "Название сессии или проекта",
    recent: "Недавние",
    none: "Сессий пока нет.",
    nothing: "Ничего не найдено",
    keys: {
      open: "открыть",
      close: "закрыть",
    },
  },
  welcome: {
    firstTitle: "Начните с папки проекта",
    firstText: "Агент работает в папке на диске: читает и правит её файлы, запускает команды. У каждого проекта свои сессии.",
    title: "Нет открытых вкладок",
    text: "Откройте сессию слева или начните новую: она откроется вкладкой.",
  },
  restoring: "Восстанавливаю вкладки…",
} as const;

const en: Dictionary<typeof ru> = {
  session: {
    projectMissing:
      "The project folder is no longer on disk: {{path}}. The terminal opens in it, so the session will continue once the folder is back.",
  },
  sessions: {
    sections: "Sections",
    title: "Sessions",
    new: "New session",
    untitled: "New session",
    running: "agent is working",
    agents: "Agents in “{{title}}”",
    collapse: "Collapse agents in “{{title}}”",
    expand: "Expand agents in “{{title}}”",
    delete: "Delete session",
    rename: "Rename",
    name: "Session name",
    newFailed: "The session was not created.",
    deleteFailed: "The session was not deleted.",
    renameFailed: "The name was not saved.",
  },
  tabs: {
    label: "Tabs of “{{project}}”",
    new: "New session in “{{project}}”",
    close: "Close tab “{{title}}”",
    closeItem: "Close tab",
    rename: "Rename",
    name: "Tab name",
    renameFailed: "The name was not saved.",
    pin: "Pin",
    unpin: "Unpin",
    pinned: "pinned",
  },
  search: {
    open: "Search",
    title: "Search sessions",
    placeholder: "Session or project name",
    recent: "Recent",
    none: "No sessions yet.",
    nothing: "Nothing found",
    keys: {
      open: "open",
      close: "close",
    },
  },
  welcome: {
    firstTitle: "Start with a project folder",
    firstText:
      "The agent works in a folder on disk: it reads and edits its files and runs commands. Each project has its own sessions.",
    title: "No open tabs",
    text: "Open a session on the left or start a new one: it opens as a tab.",
  },
  restoring: "Restoring tabs…",
};

declare module "@sapien/i18n" {
  interface Resources {
    sessions: typeof ru;
  }
}

export const dictionary = { ru, en };
