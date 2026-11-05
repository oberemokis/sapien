// Список это combobox по ARIA: фокус остаётся в поле запроса, строку выбирают
// стрелками через aria-activedescendant, мышь только дублирует их. Своих
// клавиш у строк и у затемнения поэтому нет.
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { hasModKey, Icon } from "@sapien/ui";
import { useProjects } from "@sapien/projects";
import { closeSearch, openSearch, openSession, useSearchOpen, useSessions } from "../interactions/sessions";
import { searchSessions, type FoundSession } from "../model/sessions";

// ⌘K открывает поиск, где бы ни стоял фокус. Код клавиши, а не символ:
// в русской раскладке та же клавиша печатает «л».
function useSearchShortcut() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.code !== "KeyK" || event.shiftKey || event.altKey || !hasModKey(event)) {
        return;
      }

      event.preventDefault();
      openSearch();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

// Подсказка клавиши в подвале, как Keybind дизайн-системы.
function Key({ label, children }: { label: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-xs bg-bg-layer-03 px-1 font-sans text-[11px] font-medium text-text-muted">
        {label}
      </kbd>
      {children}
    </span>
  );
}

const OPTION =
  "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px]/4 text-text-base aria-selected:bg-overlay-hover [&_svg]:text-icon-muted";

function SearchDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useSessions();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnRef = useRef<Element | null>(null);
  const listId = useId();
  const found = searchSessions(sessions.data ?? [], projects.data ?? [], query);
  const count = found.length;

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

  function choose(session: FoundSession | undefined) {
    if (session === undefined) {
      return;
    }

    close();
    openSession(session);
    void navigate({ to: "/" });
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
      choose(found[active]);
    }
  }

  let note: string | null = null;

  if (sessions.data?.length === 0) {
    note = t("agent.search.none");
  } else if (sessions.data !== undefined && count === 0) {
    note = t("agent.search.nothing");
  }

  return (
    // Нажатие на затемнение вокруг окна закрывает поиск, как Escape.
    <dialog
      ref={dialogRef}
      aria-label={t("agent.search.title")}
      className="fixed inset-x-0 top-[12vh] mx-auto w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-dock bg-bg-base p-0 text-text-base shadow-overlay backdrop:bg-overlay-scrim"
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
      <div className="flex h-12 items-center gap-2 border-b border-border-muted px-3">
        <Icon icon="magnifying-glass" size={16} className="shrink-0 text-icon-muted" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={t("agent.search.title")}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={count > 0 ? `${listId}-${active}` : undefined}
          placeholder={t("agent.search.placeholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-text-faint"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
      </div>
      <div className="max-h-[360px] overflow-y-auto p-1.5">
        {query.trim() === "" && count > 0 && (
          <p className="flex h-7 items-center px-2 text-[13px] text-text-muted">{t("agent.search.recent")}</p>
        )}
        {note !== null && <p className="px-2 py-1.5 text-[13px]/4 text-text-muted">{note}</p>}
        <div id={listId} role="listbox" aria-label={t("agent.search.title")} className="flex flex-col gap-0.5">
          {found.map((session, index) => (
            <div
              key={session.id}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={OPTION}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(session)}
            >
              <Icon icon="bubble-5" className="shrink-0" />
              <span className="min-w-0 shrink truncate font-medium">{session.title || t("agent.sessions.untitled")}</span>
              <span className="min-w-0 flex-1 truncate text-text-muted">{session.projectName}</span>
            </div>
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className="flex items-center gap-4 border-t border-border-muted px-3 py-2 text-[12px]/[18px] text-text-muted"
      >
        <Key label="↵">{t("agent.search.keys.open")}</Key>
        <Key label="esc">{t("agent.search.keys.close")}</Key>
      </div>
    </dialog>
  );
}

// Поиск сессии поверх всего. Висит в body: спрятанная панель, откуда его
// тоже открывают, недоступна для фокуса.
export function SessionSearch() {
  const open = useSearchOpen();

  useSearchShortcut();

  if (!open) {
    return null;
  }

  return createPortal(<SearchDialog />, document.body);
}
