// Основной словарь. Его форма задаёт ключи для всех языков: см. i18n.ts.
export const ru = {
  layout: {
    showFiles: "Показать боковую панель",
    hideFiles: "Скрыть боковую панель",
    showChat: "Показать чат",
    hideChat: "Скрыть чат",
    resizeFiles: "Ширина боковой панели",
    resizeChat: "Ширина чата",
  },
  files: {
    empty: "Файлов пока нет",
  },
  editor: {
    empty: "Выберите заметку",
  },
  chat: {
    empty: "Здесь будет чат с агентом",
  },
  settings: {
    open: "Настройки",
    title: "Настройки",
    back: "Назад",
    sections: "Разделы настроек",
    groups: {
      app: "Приложение",
    },
  },
  appearance: {
    title: "Внешний вид",
    description: "Как приложение выглядит на этом устройстве.",
    theme: {
      title: "Тема",
      description: "Тёмная, светлая или та же, что у системы.",
      dark: "Тёмная",
      light: "Светлая",
      system: "Как в системе",
    },
  },
} as const;
