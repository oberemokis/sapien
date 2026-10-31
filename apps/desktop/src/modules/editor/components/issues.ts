import type { CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { projectOf } from "@/core/markdown/issues";
import { hasModKey } from "@/core/ui/keys";
import { inCode } from "./hashtags";

// Что редактор знает о задаче из текста: слово на плашке и карточка
// при наведении. muted делает плашку серой: задачи нет, или статус мог
// устареть.
export type IssueMention = { label: string; muted: boolean; title: string; details: string[] };

// Задачи для номеров в тексте. Номер с префиксом не из prefixes остаётся
// текстом. Номер без записи в mentions ждёт ответа и пока без статуса.
export type IssueMentions = {
  prefixes: ReadonlySet<string>;
  mentions: ReadonlyMap<string, IssueMention>;
  // Задачи проекта для подсказки после «SAP-», свежие первыми.
  suggest: (project: string) => Promise<{ id: string; summary: string }[]>;
  onOpen: (id: string) => void;
};

type Issues = () => IssueMentions | null;

// Ответ о задачах пришёл: плашки рисуются заново.
export const refreshIssues = StateEffect.define<null>();

// Набранное перед курсором: префикс, дефис и начало номера или названия.
const TYPED = /[A-Za-z][A-Za-z0-9_]*-[\p{L}\p{N}]*/u;
const WORD = /[\p{L}\p{N}_-]/u;

class StateWidget extends WidgetType {
  readonly id: string;
  readonly mention: IssueMention;

  constructor(id: string, mention: IssueMention) {
    super();
    this.id = id;
    this.mention = mention;
  }

  eq(other: StateWidget) {
    return other.id === this.id && other.mention.label === this.mention.label && other.mention.muted === this.mention.muted;
  }

  toDOM() {
    const span = document.createElement("span");

    span.className = "cm-issue-state";
    span.classList.toggle("cm-issue-muted", this.mention.muted);
    span.dataset.issue = this.id;
    span.textContent = this.mention.label;

    return span;
  }

  // Клик по статусу ловит обработчик редактора: он открывает задачу.
  ignoreEvent() {
    return false;
  }
}

// Номер из известного проекта плашкой: сам номер правится как текст,
// а статус стоит за ним отдельным словом. Рисуется только видимая часть.
function plaques(view: EditorView, issues: IssueMentions | null) {
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;

  if (issues === null) {
    return builder.finish();
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "IssueId" || node.from <= last) {
          return;
        }

        const id = view.state.sliceDoc(node.from, node.to);
        const mention = issues.mentions.get(id);

        if (!issues.prefixes.has(projectOf(id))) {
          return;
        }

        // Узел на стыке двух видимых кусков встречается дважды.
        last = node.from;
        builder.add(node.from, node.to, Decoration.mark({ class: "cm-issue", attributes: { "data-issue": id } }));

        if (mention !== undefined) {
          builder.add(node.to, node.to, Decoration.widget({ widget: new StateWidget(id, mention), side: 1 }));
        }
      },
    });
  }

  return builder.finish();
}

export function issuePlaques(issues: Issues) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = plaques(view, issues());
      }

      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(refreshIssues)),
        );

        if (
          update.docChanged ||
          update.viewportChanged ||
          refreshed ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = plaques(update.view, issues());
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function card(mention: IssueMention) {
  const dom = document.createElement("div");
  const title = document.createElement("div");

  dom.className = "cm-issue-card";
  title.className = "cm-issue-card-title";
  title.textContent = mention.title;
  dom.append(
    title,
    ...mention.details.map((line) => {
      const row = document.createElement("div");

      row.textContent = line;

      return row;
    }),
  );

  return { dom };
}

// Наведение на номер показывает карточку задачи: название, статус,
// исполнитель, срок и связи. Пока ответа нет, карточки нет.
export function issueCards(issues: Issues) {
  return hoverTooltip((view, pos, side) => {
    const node = syntaxTree(view.state).resolveInner(pos, side);
    const known = issues();

    if (node.name !== "IssueId" || known === null) {
      return null;
    }

    const id = view.state.sliceDoc(node.from, node.to);
    const mention = known.mentions.get(id);

    if (mention === undefined || !known.prefixes.has(projectOf(id))) {
      return null;
    }

    return { pos: node.from, end: node.to, above: true, create: () => card(mention) };
  });
}

// Клик по статусу или ⌘клик по номеру открывает задачу. Простой клик
// по номеру ставит курсор: номер правится как остальной текст.
export function issueClick(issues: Issues) {
  return EditorView.domEventHandlers({
    mousedown(event) {
      const known = issues();

      if (known === null || event.button !== 0 || !(event.target instanceof Element)) {
        return false;
      }

      const plaque = event.target.closest<HTMLElement>(".cm-issue-state, .cm-issue");
      const id = plaque?.dataset.issue;

      if (id === undefined || (plaque?.classList.contains("cm-issue") && !hasModKey(event))) {
        return false;
      }

      event.preventDefault();
      known.onOpen(id);

      return true;
    },
  });
}

// Подсказка задач проекта после «SAP-»: по началу номера или по словам
// названия.
export function issueCompletion(issues: Issues): CompletionSource {
  return async (context) => {
    const known = issues();
    const typed = context.matchBefore(TYPED);

    if (known === null || typed === null || inCode(context)) {
      return null;
    }

    const project = typed.text.slice(0, typed.text.indexOf("-"));
    const query = typed.text.slice(project.length + 1).toLowerCase();

    if (!known.prefixes.has(project) || WORD.test(context.state.sliceDoc(typed.from - 1, typed.from))) {
      return null;
    }

    const options = (await known.suggest(project))
      .filter(
        ({ id, summary }) => projectOf(id) === project && (id.slice(project.length + 1).startsWith(query) || summary.toLowerCase().includes(query)),
      )
      .map(({ id, summary }) => ({ label: id, detail: summary }));

    if (options.length === 0) {
      return null;
    }

    return { from: typed.from, options, filter: false };
  };
}
