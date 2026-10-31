import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

const hidden = Decoration.replace({});
const code = Decoration.mark({ class: "cm-lp-code" });
const link = Decoration.mark({ class: "cm-lp-link" });
const quoteLine = Decoration.line({ class: "cm-lp-quote" });
const codeLine = Decoration.line({ class: "cm-lp-codeblock" });

// [[заметка]] и [[заметка|подпись]]: lezer их не разбирает, они ищутся
// в тексте строки.
const WIKI_LINK = /\[\[([^[\]|\n]+)(\|[^[\]\n]+)?\]\]/g;
const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "Frontmatter"]);

class Bullet extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const bullet = document.createElement("span");

    bullet.className = "cm-lp-bullet";
    bullet.textContent = "•";

    return bullet;
  }
}

class Rule extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const rule = document.createElement("span");

    rule.className = "cm-lp-hr";

    return rule;
  }
}

// Флажок вместо «- [ ]». Щелчок пишет в файл «x» или пробел и курсор
// не двигает. at это позиция «[» в тексте.
class Task extends WidgetType {
  readonly at: number;
  readonly checked: boolean;
  readonly editable: boolean;
  readonly label: string;

  constructor(at: number, checked: boolean, editable: boolean, label: string) {
    super();
    this.at = at;
    this.checked = checked;
    this.editable = editable;
    this.label = label;
  }

  eq(other: Task) {
    return (
      other.at === this.at &&
      other.checked === this.checked &&
      other.editable === this.editable &&
      other.label === this.label
    );
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");

    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.disabled = !this.editable;
    box.setAttribute("aria-label", this.label);
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();

      if (!this.editable) {
        return;
      }

      let mark = "x";

      if (this.checked) {
        mark = " ";
      }

      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: mark }, userEvent: "input" });
    });

    return box;
  }

  ignoreEvent() {
    return true;
  }
}

// Строки, которых касается курсор или выделение: в них разметка видна.
function revealedLines(state: EditorState) {
  const lines = new Set<number>();

  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;

    for (let line = state.doc.lineAt(range.from).number; line <= last; line += 1) {
      lines.add(line);
    }
  }

  return lines;
}

function inCode(state: EditorState, pos: number) {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);

  while (node !== null) {
    if (CODE.has(node.name)) {
      return true;
    }

    node = node.parent;
  }

  return false;
}

// Знак вместе с пробелом за ним: «# », «> ».
function withSpace(state: EditorState, from: number, to: number) {
  if (state.sliceDoc(to, to + 1) === " ") {
    return hidden.range(from, to + 1);
  }

  return hidden.range(from, to);
}

function eachLine(state: EditorState, from: number, to: number, add: (lineFrom: number) => void) {
  const last = state.doc.lineAt(to).number;

  for (let line = state.doc.lineAt(from).number; line <= last; line += 1) {
    add(state.doc.line(line).from);
  }
}

function linkRanges(node: SyntaxNode, ranges: Range<Decoration>[]) {
  const marks = node.getChildren("LinkMark");
  const open = marks[0];
  const close = marks[1];

  if (open === undefined || close === undefined || close.from <= open.to) {
    return;
  }

  ranges.push(hidden.range(open.from, open.to), link.range(open.to, close.from), hidden.range(close.from, node.to));
}

function wikiLinks(state: EditorState, from: number, to: number, revealed: Set<number>, ranges: Range<Decoration>[]) {
  const text = state.sliceDoc(from, to);

  for (const match of text.matchAll(WIKI_LINK)) {
    const start = from + match.index;
    const end = start + match[0].length;

    if (revealed.has(state.doc.lineAt(start).number) || inCode(state, start)) {
      continue;
    }

    const target = match[1] ?? "";
    let shownFrom = start + 2;

    if (match[2] !== undefined) {
      shownFrom = start + 2 + target.length + 1;
    }

    ranges.push(hidden.range(start, shownFrom), link.range(shownFrom, end - 2), hidden.range(end - 2, end));
  }
}

function decorations(view: EditorView, taskLabel: string): DecorationSet {
  const { state } = view;
  const editable = state.facet(EditorView.editable);
  const revealed = revealedLines(state);
  const ranges: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(ref) {
        const node = ref.node;
        const shown = revealed.has(state.doc.lineAt(node.from).number);

        switch (node.name) {
          // Картинки, таблицы и HTML остаются исходным текстом.
          case "Image":
          case "Table":
          case "HTMLBlock":
          case "Frontmatter":
            return false;
          case "Blockquote":
            eachLine(state, node.from, node.to, (lineFrom) => ranges.push(quoteLine.range(lineFrom)));
            break;
          case "FencedCode":
            eachLine(state, node.from, node.to, (lineFrom) => ranges.push(codeLine.range(lineFrom)));
            break;
          case "InlineCode":
            ranges.push(code.range(node.from, node.to));
            break;
          default:
            break;
        }

        if (shown) {
          return undefined;
        }

        switch (node.name) {
          case "HeaderMark":
            if (node.parent?.name.startsWith("ATXHeading")) {
              ranges.push(withSpace(state, node.from, node.to));
            }
            break;
          case "QuoteMark":
            ranges.push(withSpace(state, node.from, node.to));
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeInfo":
            ranges.push(hidden.range(node.from, node.to));
            break;
          case "CodeMark":
            ranges.push(hidden.range(node.from, node.to));
            break;
          case "Link":
            linkRanges(node, ranges);
            break;
          case "Autolink":
            for (const mark of node.getChildren("LinkMark")) {
              ranges.push(hidden.range(mark.from, mark.to));
            }
            break;
          case "HorizontalRule":
            ranges.push(Decoration.replace({ widget: new Rule() }).range(node.from, node.to));
            break;
          case "ListMark": {
            const task = node.nextSibling;

            if (task?.name === "Task") {
              const marker = task.getChild("TaskMarker");

              if (marker !== null) {
                const checked = /x/i.test(state.sliceDoc(marker.from, marker.to));
                const widget = new Task(marker.from, checked, editable, taskLabel);

                ranges.push(Decoration.replace({ widget }).range(node.from, marker.to));
              }
            } else if (node.parent?.parent?.name === "BulletList") {
              ranges.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to));
            }
            break;
          }
          default:
            break;
        }

        return undefined;
      },
    });

    wikiLinks(state, from, to, revealed, ranges);
  }

  return Decoration.set(ranges, true);
}

const theme = EditorView.theme({
  ".cm-lp-code": {
    backgroundColor: "color-mix(in srgb, var(--color-content) 8%, transparent)",
    borderRadius: "4px",
    padding: "1px 3px",
  },
  ".cm-lp-codeblock": {
    backgroundColor: "color-mix(in srgb, var(--color-content) 5%, transparent)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-code)",
  },
  ".cm-line.cm-lp-codeblock": { padding: "0 12px" },
  ".cm-line.cm-lp-quote": {
    borderLeft: "3px solid color-mix(in srgb, var(--color-content) 25%, transparent)",
    paddingLeft: "12px",
  },
  ".cm-lp-link": { color: "var(--color-link)", textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-lp-bullet": { color: "color-mix(in srgb, var(--color-content) 55%, transparent)" },
  ".cm-lp-task": { margin: "0 4px 0 0", verticalAlign: "-2px", accentColor: "var(--color-accent)" },
  ".cm-lp-hr": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
    borderTop: "1px solid var(--color-stroke)",
  },
});

// Live Preview, как в Obsidian: разметка markdown прячется везде, кроме
// строк с курсором, а флажки задач отмечаются щелчком. Текст файла не
// меняется, меняется только то, как он показан. Перерисовка идёт по
// видимой части, поэтому длинная заметка не тормозит набор.
export function livePreview(taskLabel: string) {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = decorations(view, taskLabel);
        }

        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            syntaxTree(update.startState) !== syntaxTree(update.state) ||
            update.startState.facet(EditorView.editable) !== update.state.facet(EditorView.editable)
          ) {
            this.decorations = decorations(update.view, taskLabel);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    theme,
  ];
}
