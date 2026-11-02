import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { frontmatter, hashtag } from "@/core/markdown/tags";

// Разметка видна всегда, но тише текста: заголовок крупнее, а решётки
// перед ним бледные. Цвета только токенами темы, поэтому светлая и тёмная
// тема переключают редактор так же, как остальное окно. Размеры и веса
// повторяют Markdown дизайн-системы, как в режиме чтения.
const faint = "var(--text-text-faint)";
const heading = { color: "var(--text-text-base)", fontWeight: "600" };

const highlight = HighlightStyle.define([
  { tag: tags.heading1, ...heading, fontSize: "17px" },
  { tag: tags.heading2, ...heading, fontSize: "15px" },
  { tag: tags.heading3, ...heading, fontWeight: "670" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: "var(--text-text-muted)", fontWeight: "500" },
  { tag: tags.strong, fontWeight: "670" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--text-text-accent)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "var(--text-code)" },
  { tag: tags.quote, color: "var(--text-text-muted)" },
  { tag: [tags.processingInstruction, tags.meta, tags.labelName, tags.contentSeparator], color: faint },
  // Шапка служебная, как разметка: мелко, бледно и моноширинно.
  { tag: frontmatter, fontFamily: "var(--font-mono)", fontSize: "var(--text-code)", color: faint },
  // Класс, а не стиль: по нему клик находит тег.
  { tag: hashtag, class: "cm-hashtag" },
]);

export const markdownTheme = [
  EditorView.theme({
    "&": { height: "100%", fontSize: "14px", color: "var(--text-text-base)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-sans)", lineHeight: "1.6" },
    // Строка не шире удобной для чтения, как в Obsidian. Снизу запас:
    // последняя строка поднимается к середине окна, а не прилипает к краю.
    ".cm-content": {
      boxSizing: "border-box",
      width: "100%",
      maxWidth: "760px",
      margin: "0 auto",
      padding: "8px 32px 40vh",
      caretColor: "var(--background-bg-accent)",
    },
    ".cm-line": { padding: "0" },
    // Тег плашкой, как TagChip дизайн-системы.
    ".cm-hashtag": {
      color: "var(--text-text-accent)",
      backgroundColor: "var(--background-bg-layer-02)",
      boxShadow: "inset 0 0 0 1px var(--border-border-base)",
      borderRadius: "4px",
      padding: "1px 5px",
      fontWeight: "500",
      cursor: "pointer",
    },
    // Номер задачи плашкой цвета ссылки, статус за ним мелким словом.
    // Серый статус: задачи нет, или он мог устареть.
    ".cm-issue": {
      color: "var(--text-text-accent)",
      backgroundColor: "color-mix(in srgb, var(--text-text-accent) 12%, transparent)",
      borderRadius: "4px",
      padding: "1px 3px",
    },
    ".cm-issue-state": {
      marginLeft: "4px",
      padding: "1px 6px",
      borderRadius: "999px",
      fontSize: "12px",
      color: "var(--text-text-base)",
      backgroundColor: "color-mix(in srgb, var(--text-text-base) 8%, transparent)",
      cursor: "pointer",
    },
    ".cm-issue-state.cm-issue-muted": {
      color: "var(--text-text-muted)",
      fontStyle: "italic",
    },
    ".cm-issue-card": {
      maxWidth: "360px",
      padding: "8px 10px",
      fontFamily: "var(--font-sans)",
      fontSize: "13px",
      lineHeight: "20px",
      color: "var(--text-text-muted)",
    },
    ".cm-issue-card-title": { marginBottom: "4px", fontWeight: "530", color: "var(--text-text-base)" },
    ".cm-completionDetail": { marginLeft: "8px", color: "var(--text-text-faint)" },
    // Подсказки и карточки как меню системы: подложка layer-01 и тень без рамки.
    ".cm-tooltip": {
      border: "none",
      borderRadius: "6px",
      backgroundColor: "var(--background-bg-layer-01)",
      boxShadow: "var(--elevation-floating)",
      overflow: "hidden",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-sans)", fontSize: "13px", padding: "2px" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "6px 12px", borderRadius: "4px" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--overlay-pressed)",
      color: "var(--text-text-base)",
    },
    ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600" },
  }),
  syntaxHighlighting(highlight),
];
