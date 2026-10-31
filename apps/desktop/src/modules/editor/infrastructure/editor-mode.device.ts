import type { EditorMode } from "../model/mode";

const STORAGE_KEY = "sapien.editor.mode";

// Режим редактора это настройка устройства, как тема. Хранилище окна
// бывает закрыто политикой: тогда включён Live Preview, приложение не падает.
export function readEditorMode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeEditorMode(mode: EditorMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Выбор работает до закрытия окна, только не переживёт перезапуск.
  }
}
