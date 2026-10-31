// Список это combobox по ARIA: фокус остаётся в поле запроса, строку выбирают
// стрелками через aria-activedescendant, мышь только дублирует их. Своих
// клавиш у строк и у затемнения поэтому нет. Родные select и datalist
// не показывают иконку, папку и подсветку совпавших букв.
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FileTypeIcon } from "@/core/ui/file-type-icon";
import { Icon } from "@/core/ui/icon";
import { hasModKey } from "@/core/ui/keys";
import { closeSearch, openSearch, useSearchOpen } from "../interactions/search";
import { openNote, useTreeState } from "../interactions/tree";
import { useCreateEntry, useVaultStatus, useVaultTree } from "../interactions/vault";
import { highlight, notesOf, recentNotes, searchNotes, type Found } from "../model/search";
import { checkName } from "../model/vault";

// ⌘K открывает поиск, где бы ни стоял фокус. Код клавиши, а не символ:
// в русской раскладке та же клавиша печатает «л».
function useSearchShortcut(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.code !== "KeyK" || event.shiftKey || event.altKey || !hasModKey(event)) {
        return;
      }

      event.preventDefault();
      openSearch();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

function Title({ note }: { note: Found }) {
  return (
    <span className="min-w-0 shrink truncate">
      {highlight(note.title, note.hits).map((part) => {
        if (!part.hit) {
          return <span key={part.start}>{part.text}</span>;
        }

        return (
          <mark key={part.start} className="bg-transparent font-semibold text-content">
            {part.text}
          </mark>
        );
      })}
    </span>
  );
}

const OPTION = "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] aria-selected:bg-selection";

function SearchDialog() {
  const { t } = useTranslation();
  const tree = useVaultTree();
  const { recent } = useTreeState();
  const create = useCreateEntry();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnRef = useRef<Element | null>(null);
  const listId = useId();

  const notes = useMemo(() => notesOf(tree.data ?? []), [tree.data]);
  const name = query.trim();
  const found = name === "" ? recentNotes(notes, recent) : searchNotes(notes, query);
  // Ничего не нашлось: файл с таким именем создаётся в корне.
  const offerCreate = found.length === 0 && name !== "";
  const problem = offerCreate ? checkName(name, "note", tree.data ?? []) : null;
  const count = found.length + (offerCreate ? 1 : 0);

  // Модальное окно держит фокус в себе. Куда его поставить при открытии,
  // браузеры решают по-разному, поэтому в поле запроса явно.
  useEffect(() => {
    returnRef.current = document.activeElement;
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, active]);

  // Фокус возвращается туда, где был до поиска. Сначала окно перестаёт быть
  // модальным: пока оно модальное, всё за ним недоступно для фокуса.
  function close() {
    dialogRef.current?.close();

    if (returnRef.current instanceof HTMLElement) {
      returnRef.current.focus();
    }

    closeSearch();
  }

  // Найденная заметка открывается с курсором в тексте: Enter в активной
  // вкладке, ⌘Enter и ⌘клик в новой.
  function choose(path: string, newTab: boolean) {
    close();
    openNote(path, { focus: true, newTab });
  }

  function createNote() {
    if (problem === null && !create.isPending) {
      create.mutate({ parent: "", name, kind: "note" }, { onSuccess: close });
    }
  }

  function pick(index: number, newTab: boolean) {
    const note = found[index];

    if (note !== undefined) {
      choose(note.path, newTab);
    } else if (offerCreate) {
      createNote();
    }
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count > 0) {
      event.preventDefault();
      setActive((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      pick(active, hasModKey(event));
    }
  }

  let createHint: string | null = null;

  if (problem !== null) {
    createHint = t(`vault.create.${problem}`);
  } else if (create.isError) {
    createHint = t("vault.create.failed");
  }

  return (
    // Нажатие на затемнение вокруг окна закрывает поиск, как Escape.
    <dialog
      ref={dialogRef}
      aria-label={t("vault.search.title")}
      className="fixed inset-x-0 top-[12vh] mx-auto w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-xl border border-content/8 bg-shell/95 p-0 text-content shadow-float backdrop-blur-xl backdrop:bg-scrim"
      onKeyDown={onKeyDown}
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
      <div className="flex h-11 items-center gap-2 border-b border-stroke px-3">
        <Icon icon={Search01Icon} size={15} className="shrink-0 text-content/50" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={t("vault.search.title")}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={count > 0 ? `${listId}-${active}` : undefined}
          placeholder={t("vault.search.placeholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-content/40"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            create.reset();
          }}
        />
      </div>
      <div className="max-h-[360px] overflow-y-auto p-1">
        {name === "" && found.length > 0 && (
          <p className="px-2 pt-1 pb-1.5 text-[12px] text-content/50">{t("vault.search.recent")}</p>
        )}
        {offerCreate && <p className="px-2 pt-1 pb-1.5 text-[13px] text-content/50">{t("vault.search.nothing")}</p>}
        <div id={listId} role="listbox" aria-label={t("vault.search.title")}>
          {found.map((note, index) => (
            <div
              key={note.path}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={OPTION}
              onMouseMove={() => setActive(index)}
              onClick={(event) => choose(note.path, hasModKey(event))}
            >
              <FileTypeIcon name={note.path} />
              <Title note={note} />
              {note.folder !== "" && <span className="min-w-0 flex-1 truncate text-content/40">{note.folder}</span>}
            </div>
          ))}
          {offerCreate && (
            <div
              id={`${listId}-0`}
              role="option"
              tabIndex={-1}
              aria-selected={active === 0}
              aria-disabled={problem !== null}
              aria-describedby={createHint === null ? undefined : `${listId}-hint`}
              className={`${OPTION} aria-disabled:text-content/40`}
              onMouseMove={() => setActive(0)}
              onClick={createNote}
            >
              <FileTypeIcon name="new.md" />
              <span className="truncate">{t("vault.search.create", { name })}</span>
            </div>
          )}
        </div>
        {createHint !== null && (
          <p id={`${listId}-hint`} className="px-2 pt-1 text-[12px] text-diff-del-fg">
            {createHint}
          </p>
        )}
      </div>
    </dialog>
  );
}

// Окно поиска файла поверх всего. Висит в body: спрятанное дерево, откуда
// его тоже открывают, недоступно для фокуса.
export function FileSearch() {
  const open = useSearchOpen();
  const status = useVaultStatus();

  useSearchShortcut(status.data?.kind === "ready");

  if (!open) {
    return null;
  }

  return createPortal(<SearchDialog />, document.body);
}
