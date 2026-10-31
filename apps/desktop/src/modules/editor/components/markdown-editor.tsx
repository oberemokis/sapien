import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IssueIds } from "@/core/markdown/issues";
import { Frontmatter, Hashtags } from "@/core/markdown/tags";
import { useEditorMode } from "../interactions/editor-mode";
import type { EditorMode } from "../model/mode";
import { textChange } from "../model/text-change";
import { markdownTheme } from "../ui/markdown-theme";
import { tagClick, tagCompletion } from "./hashtags";
import {
  issueCards,
  issueClick,
  issueCompletion,
  type IssueMentions,
  issuePlaques,
  refreshIssues,
} from "./issues";
import { linkClick } from "./links";
import { livePreview } from "./live-preview";

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
  // ⌘клик по ссылке в тексте.
  onLinkClick?: (url: string) => void;
  // Выделенный текст, пустая строка без выделения. Выделение помнится
  // и тогда, когда фокус ушёл из редактора, например в поле чата.
  onSelectionChange?: (text: string) => void;
  // Задачи для номеров вида SAP-12. Без них номер остаётся текстом.
  issues?: IssueMentions | null;
};

const NO_TAGS: string[] = [];

function ignore() {
  // Без обработчика клик по тегу или ссылке просто ничего не делает.
}

function preview(mode: EditorMode, taskLabel: string) {
  if (mode === "source") {
    return [];
  }

  return livePreview(taskLabel);
}

// Текст markdown с подсветкой разметки, GFM: таблицы, чекбоксы,
// зачёркивание, теги, шапка заметки. В Live Preview разметка прячется вне
// строки с курсором, режим выбирают во «Внешнем виде». HTML в тексте
// остаётся текстом: редактор ничего не рисует из заметки как HTML и ничего
// из неё не выполняет. Редактор живёт, пока
// открыт один файл: страница меняет его ключом при смене файла, а value
// дальше приходит только как правка снаружи.
export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  focusRequest = 0,
  insert = null,
  label,
  tags = NO_TAGS,
  onTagClick = ignore,
  onLinkClick = ignore,
  onSelectionChange = ignore,
  issues = null,
}: Props) {
  const { t } = useTranslation();
  const mode = useEditorMode();
  const taskLabel = t("editor.task");
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const tagsRef = useRef(tags);
  const onTagClickRef = useRef(onTagClick);
  const onLinkClickRef = useRef(onLinkClick);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const issuesRef = useRef(issues);
  const editableRef = useRef(new Compartment());
  const labelRef = useRef(new Compartment());
  const previewRef = useRef(new Compartment());
  const initialRef = useRef({ value, readOnly, label, mode, taskLabel });

  useEffect(() => {
    onChangeRef.current = onChange;
    tagsRef.current = tags;
    onTagClickRef.current = onTagClick;
    onLinkClickRef.current = onLinkClick;
    onSelectionChangeRef.current = onSelectionChange;
  }, [onChange, tags, onTagClick, onLinkClick, onSelectionChange]);

  // Пришёл ответ о задачах: плашки рисуются заново.
  useEffect(() => {
    issuesRef.current = issues;
    viewRef.current?.dispatch({ effects: refreshIssues.of(null) });
  }, [issues]);

  useEffect(() => {
    const initial = initialRef.current;
    const getIssues = () => issuesRef.current;
    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage, extensions: [Hashtags, Frontmatter, IssueIds] }),
          autocompletion({
            icons: false,
            override: [tagCompletion(() => tagsRef.current), issueCompletion(getIssues)],
          }),
          issuePlaques(getIssues),
          issueCards(getIssues),
          issueClick(getIssues),
          tagClick((tag) => onTagClickRef.current(tag)),
          linkClick((url) => onLinkClickRef.current(url)),
          EditorView.lineWrapping,
          labelRef.current.of(EditorView.contentAttributes.of({ "aria-label": initial.label })),
          editableRef.current.of(EditorView.editable.of(!initial.readOnly)),
          previewRef.current.of(preview(initial.mode, initial.taskLabel)),
          markdownTheme,
          EditorView.updateListener.of((update) => {
            const fromOutside = update.transactions.some((transaction) => transaction.annotation(external));

            if (update.docChanged && !fromOutside) {
              onChangeRef.current(update.state.doc.toString());
            }

            if (update.selectionSet) {
              const { from, to } = update.state.selection.main;

              onSelectionChangeRef.current(update.state.sliceDoc(from, to));
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

  useEffect(() => {
    viewRef.current?.dispatch({ effects: previewRef.current.reconfigure(preview(mode, taskLabel)) });
  }, [mode, taskLabel]);

  // Файл переименовали снаружи, а редактор с курсором остался прежним.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: labelRef.current.reconfigure(EditorView.contentAttributes.of({ "aria-label": label })),
    });
  }, [label]);

  return <div ref={hostRef} className="min-h-0 flex-1" />;
}
