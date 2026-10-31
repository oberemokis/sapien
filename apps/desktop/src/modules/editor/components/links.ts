import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { hasModKey } from "@/core/ui/keys";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

// Адрес под позицией: сам адрес, адрес ссылки [текст](адрес) по её тексту
// или ссылка в угловых скобках.
function urlAt(state: EditorState, pos: number) {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);

  while (node !== null) {
    if (node.name === "URL") {
      return state.sliceDoc(node.from, node.to);
    }

    if (node.name === "Link" || node.name === "Autolink") {
      break;
    }

    node = node.parent;
  }

  // У ссылки по сноске [текст][метка] адреса внутри нет.
  const url = node?.getChild("URL");

  if (url === undefined || url === null) {
    return null;
  }

  return state.sliceDoc(url.from, url.to);
}

// ⌘клик по ссылке отдаёт её адрес наружу, как в VS Code: простой клик
// ставит курсор, и адрес правится как остальной текст. Куда адрес пойдёт
// и годится ли он, решает тот, кто его принял.
export function linkClick(onLinkClick: (url: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !hasModKey(event) || !(event.target instanceof Node)) {
        return false;
      }

      const url = urlAt(view.state, view.posAtDOM(event.target));

      if (url === null) {
        return false;
      }

      event.preventDefault();
      onLinkClick(url);

      return true;
    },
  });
}
