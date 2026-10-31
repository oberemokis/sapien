import { createStore } from "@tanstack/react-store";

// Окно поиска файлов. Его открывают ⌘K, поле над деревом и кнопка
// «Открыть файл» в пустой середине.
export const searchStore = createStore({ open: false });
