// Live Preview прячет разметку вне строки с курсором, исходный текст
// показывает её всегда.
export const EDITOR_MODES = ["preview", "source"] as const;

export type EditorMode = (typeof EDITOR_MODES)[number];

export function parseEditorMode(raw: unknown): EditorMode {
  return EDITOR_MODES.find((mode) => mode === raw) ?? "preview";
}
