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
} as const;
