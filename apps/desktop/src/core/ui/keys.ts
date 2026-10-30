// На macOS команды висят на ⌘, на остальных системах на Ctrl.
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

// Подпись сочетания в подсказке: «⇧⌘B» на macOS, «Ctrl+Shift+B» на остальных.
export function shortcutLabel(key: string, shift = false) {
  if (isMac) {
    return [shift && "⇧", "⌘", key].filter(Boolean).join("");
  }

  return ["Ctrl", shift && "Shift", key].filter(Boolean).join("+");
}

export function hasModKey(event: KeyboardEvent) {
  if (isMac) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}
