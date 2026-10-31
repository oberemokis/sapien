import { createStore } from "@tanstack/react-store";

// Окно истории версий и заметка, чья история в нём. Его открывают кнопка
// над заметкой и список удалённых заметок.
export const historyStore = createStore<{ path: string | null }>({ path: null });
