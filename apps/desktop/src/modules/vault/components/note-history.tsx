import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { IconButton } from "@/core/ui/icon-button";
import { closeHistory, useHistoryPath, useRestoreVersion, useVersions, useVersionText } from "../interactions/history";
import { useNoteText } from "../interactions/note";
import { diffLines, type DiffLine } from "../model/diff";
import { notePlace } from "../model/vault";

const LINE: Record<DiffLine["kind"], string> = {
  same: "",
  removed: "bg-diff-del-bg text-diff-del-fg",
  added: "bg-diff-add-bg text-diff-add-fg",
};

const MARK: Record<DiffLine["kind"], string> = { same: " ", removed: "−", added: "+" };

// Версия против того, что в заметке сейчас: красным то, чего уже нет,
// зелёным то, чего не было.
function Diff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);

  return (
    <div className="min-w-max font-mono text-[12px] leading-5">
      {lines.map((line, index) => (
        // Строки не переставляются, их место в сравнении и есть ключ.
        // oxlint-disable-next-line react/no-array-index-key
        <div key={index} className={`px-3 whitespace-pre ${LINE[line.kind]}`}>
          <span aria-hidden className="mr-3 inline-block w-2 text-content/40">
            {MARK[line.kind]}
          </span>
          {line.text}
        </div>
      ))}
    </div>
  );
}

function HistoryDialog({ path }: { path: string }) {
  const { t, i18n } = useTranslation();
  const versions = useVersions(path);
  const current = useNoteText(path);
  const [chosen, setChosen] = useState<number | null>(null);
  const selected = chosen ?? versions.data?.[0]?.id ?? null;
  const version = useVersionText(path, selected);
  const restore = useRestoreVersion();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnRef = useRef<Element | null>(null);
  const time = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
    [i18n.language],
  );

  useEffect(() => {
    returnRef.current = document.activeElement;
    dialogRef.current?.showModal();
  }, []);

  function close() {
    dialogRef.current?.close();

    if (returnRef.current instanceof HTMLElement) {
      returnRef.current.focus();
    }

    closeHistory();
  }

  const title = t("vault.history.title", { title: notePlace(path).title });

  return (
    // Нажатие на затемнение вокруг окна закрывает его, как Escape.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      aria-label={title}
      className="fixed inset-x-0 top-[10vh] mx-auto flex h-[min(560px,80vh)] w-[min(880px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-content/8 bg-shell/95 p-0 text-content shadow-float backdrop-blur-xl backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-stroke pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</h2>
        <IconButton icon={Cancel01Icon} label={t("vault.history.close")} onClick={close} />
      </header>
      <div className="flex min-h-0 flex-1">
        <ul aria-label={t("vault.history.versions")} className="w-56 shrink-0 overflow-y-auto border-r border-stroke p-1">
          {versions.data?.map(({ id, source }) => (
            <li key={id}>
              <button
                type="button"
                aria-current={id === selected || undefined}
                className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-120 hover:bg-selection-hover aria-current:bg-selection"
                onClick={() => setChosen(id)}
              >
                <span>{time.format(id)}</span>
                <span className="text-[12px] text-content/50">{t(`vault.history.source.${source}`)}</span>
              </button>
            </li>
          ))}
        </ul>
        <section aria-label={t("vault.history.compare")} className="min-w-0 flex-1 overflow-auto py-2">
          {versions.data?.length === 0 && <p className="px-4 text-[13px] text-content/50">{t("vault.history.empty")}</p>}
          {version.data !== undefined && <Diff before={version.data} after={current.text ?? ""} />}
        </section>
      </div>
      <footer className="flex shrink-0 items-center gap-3 border-t border-stroke px-4 py-2">
        <p className="flex-1 text-[12px] text-content/50">{t("vault.history.legend")}</p>
        {restore.isError && (
          <p role="alert" className="text-[12px] text-diff-del-fg">
            {t("vault.history.restoreFailed")}
          </p>
        )}
        <Button
          disabled={selected === null || restore.isPending}
          onClick={() => {
            if (selected !== null) {
              restore.mutate({ path, id: selected });
            }
          }}
        >
          {t("vault.history.restore")}
        </Button>
      </footer>
    </dialog>
  );
}

// Окно истории версий поверх всего, в body, как окно поиска.
export function NoteHistory() {
  const path = useHistoryPath();

  if (path === null) {
    return null;
  }

  return createPortal(<HistoryDialog key={path} path={path} />, document.body);
}
