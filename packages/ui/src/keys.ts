// Подпись сочетания в подсказке: «⇧⌘B».
export function shortcutLabel(key: string, shift = false) {
  return [shift && "⇧", "⌘", key].filter(Boolean).join("");
}

// Для клавиш и для щелчка мыши: ⌘клик открывает в новой вкладке.
export function hasModKey(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) {
  return event.metaKey && !event.ctrlKey;
}
