import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Разметка видна всегда, но тише текста: заголовок крупный, а решётки
// перед ним бледные. Цвета только токенами темы, поэтому светлая и тёмная
// тема переключают редактор так же, как остальное окно.
const faint = "color-mix(in srgb, var(--color-content) 40%, transparent)";
const heading = { color: "var(--color-markdown-heading)", fontWeight: "600" };

const highlight = HighlightStyle.define([
  { tag: tags.heading1, ...heading, fontSize: "1.6em" },
  { tag: tags.heading2, ...heading, fontSize: "1.35em" },
  { tag: tags.heading3, ...heading, fontSize: "1.15em" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], ...heading },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--color-link)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "var(--text-code)" },
  { tag: tags.quote, fontStyle: "italic" },
  { tag: [tags.processingInstruction, tags.meta, tags.labelName, tags.contentSeparator], color: faint },
]);

export const markdownTheme = [
  EditorView.theme({
    "&": { height: "100%", fontSize: "15px", color: "var(--color-content)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-sans)", lineHeight: "1.65" },
    // Строка не шире удобной для чтения, как в Obsidian. Снизу запас:
    // последняя строка поднимается к середине окна, а не прилипает к краю.
    ".cm-content": {
      boxSizing: "border-box",
      width: "100%",
      maxWidth: "760px",
      margin: "0 auto",
      padding: "8px 32px 40vh",
      caretColor: "var(--color-accent)",
    },
    ".cm-line": { padding: "0" },
  }),
  syntaxHighlighting(highlight),
];
