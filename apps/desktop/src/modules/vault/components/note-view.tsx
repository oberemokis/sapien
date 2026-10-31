import Note01Icon from "@hugeicons/core-free-icons/Note01Icon";
import { Fragment, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { useNote } from "../interactions/note";
import { openSearch } from "../interactions/search";
import { startCreate, useTreeState } from "../interactions/tree";
import { notePlace, type EditorProps } from "../model/vault";

type Props = {
  // Редактор текста. Его ставит страница, хранилище знает только, что ему отдать.
  editor: ComponentType<EditorProps>;
  // Показывает спрятанное дерево: поле нового файла живёт в нём.
  showFiles: () => void;
};

function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="mx-4 mb-2 flex items-center gap-3 rounded-md bg-diff-del-bg px-3 py-2 text-[13px]">
      <p className="flex-1">{children}</p>
      {action}
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
          <Button onClick={openSearch}>{t("editor.openNote")}</Button>
        </div>
      </div>
    </div>
  );
}

function OpenNote({ path, focus, editor: Editor }: { path: string; focus: boolean; editor: Props["editor"] }) {
  const { t } = useTranslation();
  const note = useNote(path);
  const { title, folders } = notePlace(path);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label={t("editor.path")} className="flex h-10 shrink-0 items-center gap-1.5 px-4 text-[13px]">
        {folders.map((folder, index) => (
          <Fragment key={folders.slice(0, index + 1).join("/")}>
            <span className="truncate text-content/50">{folder}</span>
            <span className="text-content/30">/</span>
          </Fragment>
        ))}
        <h1 className="truncate font-medium">{title}</h1>
      </nav>
      {note.missing && <Notice>{t("editor.missing")}</Notice>}
      {note.unreadable && !note.missing && <Notice>{t("editor.unreadable")}</Notice>}
      {note.saveFailed && !note.missing && (
        <Notice
          action={
            <button type="button" className="shrink-0 underline underline-offset-2" onClick={note.retry}>
              {t("editor.retry")}
            </button>
          }
        >
          {t("editor.saveFailed")}
        </Notice>
      )}
      {note.text !== undefined && (
        <Editor value={note.text} onChange={note.change} readOnly={note.missing} focusOnMount={focus} label={title} />
      )}
    </div>
  );
}

// Середина окна: открытая заметка или пустой экран.
export function NoteView({ editor, showFiles }: Props) {
  const { open } = useTreeState();

  if (open === null) {
    return <NoNote showFiles={showFiles} />;
  }

  // Ключ по пути: у каждого файла свой редактор со своей историей правок.
  return <OpenNote key={open.path} path={open.path} focus={open.focus} editor={editor} />;
}
