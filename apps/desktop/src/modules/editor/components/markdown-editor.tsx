import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { Hashtags } from "@/core/markdown/tags";
import { textChange } from "../model/text-change";
import { markdownTheme } from "../ui/markdown-theme";
import { tagClick, tagCompletion } from "./hashtags";

// Пометка правки, пришедшей снаружи: её не возвращают обратно через onChange.
const external = Annotation.define<boolean>();

type Props = {
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  // Каждый новый номер больше нуля ставит курсор в текст.
  focusRequest?: number;
  // Текст на место курсора. Новая строка вставляется один раз.
  insert?: string | null;
  label: string;
  // Теги для подсказки после «#».
  tags?: string[];
  onTagClick?: (tag: string) => void;
};

const NO_TAGS: string[] = [];

function ignoreTag() {
  // Без обработчика клик по тегу просто ничего не делает.
}

// Исходный текст markdown с подсветкой разметки, GFM: таблицы, чекбоксы,
// зачёркивание, теги. Редактор живёт, пока открыт один файл: страница меняет
// его ключом при смене файла, а value дальше приходит только как правка снаружи.
export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  focusRequest = 0,
  insert = null,
  label,
  tags = NO_TAGS,
  onTagClick = ignoreTag,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const tagsRef = useRef(tags);
  const onTagClickRef = useRef(onTagClick);
  const editableRef = useRef(new Compartment());
  const initialRef = useRef({ value, readOnly, label });

  useEffect(() => {
    onChangeRef.current = onChange;
    tagsRef.current = tags;
    onTagClickRef.current = onTagClick;
  }, [onChange, tags, onTagClick]);

  useEffect(() => {
    const initial = initialRef.current;
    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage, extensions: Hashtags }),
          tagCompletion(() => tagsRef.current),
          tagClick((tag) => onTagClickRef.current(tag)),
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

  // Вставка у курсора, например шаблона. Выделенное не заменяется, текст
  // встаёт рядом с ним, и курсор уходит в конец вставленного. Это правка
  // человека: она уходит наружу и отменяется ⌘Z.
  useEffect(() => {
    const view = viewRef.current;

    if (view === null || insert === null) {
      return;
    }

    const at = view.state.selection.main.head;

    view.dispatch({
      changes: { from: at, insert },
      selection: { anchor: at + insert.length },
      scrollIntoView: true,
      userEvent: "input",
    });
    view.focus();
  }, [insert]);

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
