import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

// То, что набрано после решётки, и узлы кода, где тегов не бывает.
const TYPED = /#[\p{L}\p{M}\p{N}_\-/]*/u;
const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "URL"]);

function inCode(context: CompletionContext) {
  let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1);

  while (node !== null) {
    if (CODE.has(node.name)) {
      return true;
    }

    node = node.parent;
  }

  return false;
}

// Подсказка тегов хранилища после «#» в начале строки или после пробела,
// как в Obsidian. Список берётся при каждом вызове: теги приходят позже
// редактора и меняются, пока он открыт.
export function tagCompletion(tags: () => string[]) {
  return autocompletion({
    icons: false,
    override: [
      (context) => {
        const typed = context.matchBefore(TYPED);
        const line = context.state.doc.lineAt(context.pos);

        if (typed === null || inCode(context)) {
          return null;
        }

        if (typed.from > line.from && !/\s/.test(context.state.sliceDoc(typed.from - 1, typed.from))) {
          return null;
        }

        const options = tags().map((tag) => ({ label: `#${tag}` }));

        if (options.length === 0) {
          return null;
        }

        return { from: typed.from, options, validFor: /^#[\p{L}\p{M}\p{N}_\-/]*$/u };
      },
    ],
  });
}

// Клик по тегу показывает заметки с ним, курсор при этом не ставится.
// Поправить тег можно стрелками или щелчком рядом с ним.
export function tagClick(onTagClick: (tag: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(event) {
      if (!(event.target instanceof Element)) {
        return false;
      }

      const tag = event.target.closest(".cm-hashtag");

      if (tag === null || event.button !== 0 || event.shiftKey || event.altKey) {
        return false;
      }

      event.preventDefault();
      onTagClick(tag.textContent?.slice(1) ?? "");

      return true;
    },
  });
}
