import { createStore } from "@tanstack/react-store";

// Выделенный текст в редакторе заметки и её путь. Редакторы скрытых
// вкладок тоже живут, поэтому путь отличает выделение активной.
export const selectionStore = createStore<{ path: string; text: string } | null>(null);
