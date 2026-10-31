import FilePasteIcon from "@hugeicons/core-free-icons/FilePasteIcon";
import HistoryIcon from "@hugeicons/core-free-icons/HistoryIcon";
import Note01Icon from "@hugeicons/core-free-icons/Note01Icon";
import { Fragment, useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { selectText } from "../interactions/active-note";
import { openHistory } from "../interactions/history";
import { useLeftUnsaved } from "../interactions/journal";
import { useNote } from "../interactions/note";
import { openSearch, pickTemplate, showTag } from "../interactions/search";
import { useTagList } from "../interactions/tags";
import { useTemplateSettings } from "../interactions/templates";
import { focusDone, insertDone, startCreate, tabKey, useTreeState } from "../interactions/tree";
import { isTemplate } from "../model/templates";
import { notePlace, type EditorProps } from "../model/vault";
import { NoteHistory } from "./note-history";

type Props = {
  // Редактор текста. Его ставит страница, хранилище знает только, что ему отдать.
  editor: ComponentType<EditorProps>;
  // Показывает спрятанное дерево: поле нового файла живёт в нём.
  showFiles: () => void;
  // Что стоит над текстом заметки, например форма черновика задачи. Правит
  // ту же заметку, что и редактор. Над шаблоном его нет: шаблон это
  // заготовка, а не заметка, и публиковать его нечего.
  above?: ComponentType<{ path: string; text: string; readOnly: boolean; onChange: (text: string) => void }>;
};

function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="mx-4 mb-2 flex items-center gap-3 rounded-md bg-diff-del-bg px-3 py-2 text-[13px]">
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}

function NoticeAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="shrink-0 underline underline-offset-2" onClick={onClick}>
      {children}
    </button>
  );
}

// Правки, которые не дошли до файлов в прошлый раз. Предложение висит над
// заметками, пока человек не ответит.
function LeftUnsaved() {
  const { t } = useTranslation();
  const left = useLeftUnsaved();

  if (left.entries.length === 0) {
    return null;
  }

  const names = left.entries.map(({ path }) => notePlace(path).title).join(", ");

  return (
    <div className="pt-2">
      <Notice
        action={
          <>
            <NoticeAction onClick={left.restore}>{t("editor.restore")}</NoticeAction>
            <NoticeAction onClick={left.discard}>{t("editor.discard")}</NoticeAction>
          </>
        }
      >
        {t("editor.left", { names })}
      </Notice>
    </div>
  );
}

// Ничего не открыто: подсказка и два пути дальше, как пустые экраны MonoCode.
function NoNote({ showFiles }: Pick<Props, "showFiles">) {
  const { t } = useTranslation();

  return (
    <div className="grid flex-1 place-items-center p-4">
      <div className="flex flex-col items-center gap-3 text-center text-content/50">
        <Icon icon={Note01Icon} size={20} />
        <p className="text-sm">{t("editor.empty")}</p>
        <div className="flex gap-2 text-content">
          <Button
            onClick={() => {
              startCreate("note");
              showFiles();
            }}
          >
            {t("editor.newNote")}
          </Button>
          <Button onClick={() => openSearch()}>{t("editor.openNote")}</Button>
        </div>
      </div>
    </div>
  );
}

type OpenNoteProps = {
  path: string;
  hidden: boolean;
  focusRequest: number;
  insert: string | null;
  tags: string[];
  editor: Props["editor"];
  above: Props["above"];
};

function OpenNote({ path, hidden, focusRequest, insert, tags, editor: Editor, above: Above }: OpenNoteProps) {
  const { t } = useTranslation();
  const note = useNote(path);
  const { title, folders } = notePlace(path);
  const { save } = note;
  const template = isTemplate(path, useTemplateSettings().folder);

  // Ушли на другую вкладку посреди правки: она пишется сразу, не дожидаясь
  // паузы в наборе.
  useEffect(() => {
    if (hidden) {
      save();
    }
  }, [hidden, save]);

  // Редактор появляется, когда пришёл текст, и в этот же проход забирает
  // курсор. После этого просьба снимается: заметка, открытая заново,
  // не заберёт курсор у того, кто держит его сейчас.
  const loaded = note.text !== undefined;

  useEffect(() => {
    if (focusRequest > 0 && loaded) {
      focusDone(path);
    }
  }, [focusRequest, loaded, path]);

  // Так же разово и вставка: редактор вставил текст в этот проход.
  useEffect(() => {
    if (insert !== null && loaded) {
      insertDone(path);
    }
  }, [insert, loaded, path]);

  return (
    <div hidden={hidden} className="flex min-h-0 flex-1 flex-col">
      <nav aria-label={t("editor.path")} className="flex h-10 shrink-0 items-center gap-1.5 px-4 text-[13px]">
        {folders.map((folder, index) => (
          <Fragment key={folders.slice(0, index + 1).join("/")}>
            <span className="truncate text-content/50">{folder}</span>
            <span className="text-content/30">/</span>
          </Fragment>
        ))}
        <h1 className="truncate font-medium">{title}</h1>
        <div className="ml-auto flex gap-0.5">
          {!note.missing && (
            <IconButton
              icon={FilePasteIcon}
              label={t("vault.templates.insert")}
              onClick={() => pickTemplate({ kind: "insertTemplate", path })}
            />
          )}
          <IconButton icon={HistoryIcon} label={t("vault.history.open")} onClick={() => openHistory(path)} />
        </div>
      </nav>
      {note.missing && <Notice>{t("editor.missing")}</Notice>}
      {note.unreadable && !note.missing && <Notice>{t("editor.unreadable")}</Notice>}
      {note.saveFailed && !note.missing && (
        <Notice action={<NoticeAction onClick={save}>{t("editor.retry")}</NoticeAction>}>
          {t("editor.saveFailed")}
        </Notice>
      )}
      {/* Обе версии на экране: своя в редакторе, с диска под предупреждением.
          Слить это перенести нужное из версии с диска и оставить свою. */}
      {note.conflict && (
        <>
          <Notice
            action={
              <>
                <NoticeAction onClick={note.keepMine}>{t("editor.keepMine")}</NoticeAction>
                <NoticeAction onClick={note.takeDisk}>{t("editor.takeDisk")}</NoticeAction>
              </>
            }
          >
            {t("editor.conflict")}
          </Notice>
          <section
            aria-label={t("editor.diskVersion")}
            className="mx-4 mb-2 max-h-48 shrink-0 overflow-auto rounded-md border border-stroke px-3 py-2"
          >
            <pre className="font-mono text-[12px] whitespace-pre-wrap">{note.disk}</pre>
          </section>
        </>
      )}
      {note.text !== undefined && Above !== undefined && !template && (
        <Above path={path} text={note.text} readOnly={note.missing} onChange={note.change} />
      )}
      {note.text !== undefined && (
        <Editor
          value={note.text}
          onChange={note.change}
          readOnly={note.missing}
          focusRequest={focusRequest}
          insert={insert}
          label={title}
          tags={tags}
          onTagClick={showTag}
          onLinkClick={openLink}
          onSelectionChange={(text) => selectText(path, text)}
        />
      )}
    </div>
  );
}

// Середина окна: открытые заметки или пустой экран. Заметки всех вкладок
// живут, на экране только активная: у каждой своя история правок
// и прокрутка, и они переживают переключение вкладок.
export function NoteView({ editor, showFiles, above }: Props) {
  const { tabs, active, focus, insert } = useTreeState();
  const tagList = useTagList();
  const tags = useMemo(() => tagList.map((tag) => tag.name), [tagList]);

  if (active === null) {
    return (
      <>
        <LeftUnsaved />
        <NoNote showFiles={showFiles} />
        <NoteHistory />
      </>
    );
  }

  return (
    <>
      <LeftUnsaved />
      <NoteHistory />
      {tabs.map((path) => (
        <OpenNote
          key={tabKey(path)}
          path={path}
          hidden={path !== active}
          focusRequest={focus?.path === path ? focus.request : 0}
          insert={insert?.path === path ? insert.text : null}
          tags={tags}
          editor={editor}
          above={above}
        />
      ))}
    </>
  );
}
