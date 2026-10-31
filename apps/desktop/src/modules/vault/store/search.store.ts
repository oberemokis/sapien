import { createStore } from "@tanstack/react-store";

// Окно поиска файлов. Его открывают ⌘K, поле над деревом и кнопка
// «Открыть файл» в пустой середине, а клик по тегу открывает его сразу
// с запросом «#тег».
export const searchStore = createStore({ open: false, query: "" });
