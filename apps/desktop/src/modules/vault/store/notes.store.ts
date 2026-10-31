import { createStore } from "@tanstack/react-store";

export type NotesState = {
  // Текст, которого ещё нет на диске, по пути заметки. Живёт здесь, а не
  // в редакторе: переключился на другой файл, сохранить не удалось,
  // и правка не пропала, а ждёт возвращения.
  unsaved: Record<string, string>;
  // Код ошибки последней записи по пути заметки.
  failed: Record<string, string>;
};

export const EMPTY_NOTES: NotesState = { unsaved: {}, failed: {} };

export const notesStore = createStore<NotesState>(EMPTY_NOTES);
