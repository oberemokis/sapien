import { createStore } from "@tanstack/react-store";

// Что выбирают в окне: файл, который откроется, шаблон для нового
// файла в папке либо для вставки в открытую заметку или удалённую заметку,
// чью историю версий открыть. within сужает выбор шаблона до подпапки
// папки шаблонов, например шаблонов задач.
export type SearchMode =
  | { kind: "files" }
  | { kind: "newFromTemplate"; parent: string; within?: string }
  | { kind: "insertTemplate"; path: string }
  | { kind: "deleted" };

export const FILES: SearchMode = { kind: "files" };

// Окно поиска файлов. Его открывают ⌘K, поле над деревом и кнопка
// «Открыть файл» в пустой середине, а клик по тегу открывает его сразу
// с запросом «#тег». Им же выбирают шаблон.
export const searchStore = createStore<{ open: boolean; query: string; mode: SearchMode }>({
  open: false,
  query: "",
  mode: FILES,
});
