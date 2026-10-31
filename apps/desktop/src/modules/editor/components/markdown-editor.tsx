import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { textChange } from "../model/text-change";
import { markdownTheme } from "../ui/markdown-theme";

// Пометка правки, пришедшей снаружи: её не возвращают обратно через onChange.
const external = Annotation.define<boolean>();

type Props = {
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  // Каждый новый номер больше нуля ставит курсор в текст.
  focusRequest?: number;
  label: string;
};

// Исходный текст markdown с подсветкой разметки, GFM: таблицы, чекбоксы,
// зачёркивание. Редактор живёт, пока открыт один файл: страница меняет его
// ключом при смене файла, а value дальше приходит только как правка снаружи.
export function MarkdownEditor({ value, onChange, readOnly = false, focusRequest = 0, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const editableRef = useRef(new Compartment());
  const initialRef = useRef({ value, readOnly, label });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const initial = initialRef.current;
    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": initial.label }),
          editableRef.current.of(EditorView.editable.of(!initial.readOnly)),
          markdownTheme,
          EditorView.updateListener.of((update) => {
            const fromOutside = update.transactions.some((transaction) => transaction.annotation(external));

            if (update.docChanged && !fromOutside) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;

    return () => view.destroy();
  }, []);

  useEffect(() => {
    if (focusRequest > 0) {
      viewRef.current?.focus();
    }
  }, [focusRequest]);

  // Файл поменяли снаружи. Правка не попадает в историю: Cmd+Z отменяет
  // только своё.
  useEffect(() => {
    const view = viewRef.current;
    const current = view?.state.doc.toString();

    if (view === null || current === undefined || current === value) {
      return;
    }

    view.dispatch({
      changes: textChange(current, value),
      annotations: [external.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableRef.current.reconfigure(EditorView.editable.of(!readOnly)),
    });
  }, [readOnly]);

  return <div ref={hostRef} className="min-h-0 flex-1" />;
}
