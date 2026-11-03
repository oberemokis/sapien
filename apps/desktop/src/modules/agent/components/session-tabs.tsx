import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type MenuItem } from "@/core/ui/context-menu";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import {
  closeSession,
  moveSessionTab,
  openSession,
  pinSession,
  useNewSession,
  useProjects,
  useRenameSession,
  useSessions,
  useTabs,
} from "../interactions/sessions";
import type { SessionInfo } from "../model/sessions";
import { moveTab } from "../model/tabs";

// Сдвиг указателя в пикселях, после которого нажатие на вкладку
// становится перетаскиванием.
const DRAG_START = 4;

// Куда встанет перетаскиваемая вкладка session: перед вкладкой before,
// с null в конец.
type Drop = { session: string; before: string | null };

type Menu = { x: number; y: number; session: SessionInfo };

// Поле имени на месте вкладки. Enter и уход фокуса сохраняют, Escape
// отменяет. null: имя не меняли.
function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function finish(value: string | null) {
    if (!done.current) {
      done.current = true;
      onDone(value);
    }
  }

  return (
    <input
      ref={input}
      aria-label={t("agent.tabs.name")}
      defaultValue={title}
      placeholder={t("agent.sessions.untitled")}
      maxLength={100}
      className="h-7 w-44 rounded-md bg-overlay-pressed px-2.5 text-[13px] text-text-base outline-2 -outline-offset-2 outline-border-focus placeholder:text-text-faint"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          finish(event.currentTarget.value);
        }

        if (event.key === "Escape") {
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}

// Вкладки открытого проекта в верхней полосе окна. Вкладка это сессия:
// нажатие открывает её, крестик закрывает вкладку, а сессия остаётся
// в списке слева. Агент отвечает и в фоновой вкладке, её отмечает точка.
// «+» начинает новую сессию в этом же проекте. Двойное нажатие или меню
// переименовывают сессию, меню закрепляет вкладку: закреплённая стоит
// левее остальных, с именем целиком и без крестика. Вкладки переставляют
// перетаскиванием. Для чтения с экрана это навигация, а не tablist:
// tablist держит одни вкладки, без крестиков и «+».
export function SessionTabs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tabs = useTabs();
  const sessions = useSessions();
  const projects = useProjects();
  const newSession = useNewSession();
  const rename = useRenameSession();
  const onChat = useRouterState({ select: (state) => state.location.pathname === "/" });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const list = useRef<HTMLUListElement>(null);
  // Отпущенная после перетаскивания вкладка не открывается.
  const dragged = useRef(false);
  const project = projects.data?.find((candidate) => candidate.id === tabs.project);

  if (project === undefined) {
    return null;
  }

  const open = tabs.sessions.flatMap((id) => sessions.data?.filter((session) => session.id === id) ?? []);
  const own = { sessions: tabs.sessions, active: tabs.active, pinned: tabs.pinned };
  let target: string | null | undefined;

  // Черта показывает, куда встанет вкладка: перед той, что окажется за ней.
  // Закреплённая не уходит к обычным, поэтому место берётся из модели.
  if (drop !== null) {
    const order = moveTab({ project: project.id, projects: { [project.id]: own } }, project.id, drop.session, drop.before)
      .projects[project.id]?.sessions;

    if (order !== undefined && order.join() !== tabs.sessions.join()) {
      target = order[order.indexOf(drop.session) + 1] ?? null;
    }
  }

  function show(session: SessionInfo) {
    openSession(session);
    void navigate({ to: "/" });
  }

  // Вкладка, перед которой встанет перетаскиваемая, по середине вкладок
  // под указателем.
  function beforeAt(x: number, session: string) {
    const shown = [...(list.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];
    const found = shown.find((item) => {
      const box = item.getBoundingClientRect();

      return item.dataset.session !== session && x < box.left + box.width / 2;
    });

    return found?.dataset.session ?? null;
  }

  function startDrag(event: PointerEvent, session: SessionInfo) {
    dragged.current = false;

    if (event.button !== 0) {
      return;
    }

    const from = event.clientX;
    let before: string | null | undefined;

    const move = (moved: globalThis.PointerEvent) => {
      if (before === undefined && Math.abs(moved.clientX - from) < DRAG_START) {
        return;
      }

      before = beforeAt(moved.clientX, session.id);
      setDrop({ session: session.id, before });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDrop(null);

      if (before !== undefined) {
        dragged.current = true;
        moveSessionTab(session, before);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function finishRename(session: SessionInfo, title: string | null) {
    setRenaming(null);

    if (title !== null && title.trim() !== session.title) {
      rename.mutate({ id: session.id, title });
    }
  }

  function openMenu(event: MouseEvent, session: SessionInfo) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, session });
  }

  function items(session: SessionInfo): MenuItem[] {
    const pinned = tabs.pinned.includes(session.id);
    const all: MenuItem[] = [
      { label: t("agent.tabs.rename"), onSelect: () => setRenaming(session.id) },
      { label: pinned ? t("agent.tabs.unpin") : t("agent.tabs.pin"), onSelect: () => pinSession(session, !pinned) },
    ];

    if (!pinned) {
      all.push({ label: t("agent.tabs.closeItem"), separated: true, onSelect: () => closeSession(session) });
    }

    return all;
  }

  return (
    <nav aria-label={t("agent.tabs.label", { project: project.name })} className="flex min-w-0 items-center gap-1">
      <ul ref={list} className="flex min-w-0 items-center gap-1">
        {open.map((session) => {
          const selected = onChat && session.id === tabs.active;
          const pinned = tabs.pinned.includes(session.id);
          const title = session.title || t("agent.sessions.untitled");

          if (renaming === session.id) {
            return (
              <li key={session.id} data-session={session.id} className="flex shrink-0 items-center">
                <RenameField title={session.title} onDone={(next) => finishRename(session, next)} />
              </li>
            );
          }

          return (
            <li
              key={session.id}
              data-session={session.id}
              className={`group relative flex h-7 min-w-0 items-center rounded-md transition-colors duration-120 select-none ${
                pinned ? "shrink-0" : "max-w-52 shrink"
              } ${selected ? "bg-overlay-pressed text-text-base" : "text-text-muted hover:bg-overlay-hover hover:text-text-base"} ${
                drop?.session === session.id ? "opacity-60" : ""
              }`}
            >
              {target === session.id && (
                <span aria-hidden className="absolute inset-y-1 -left-0.75 w-0.5 rounded-full bg-border-focus" />
              )}
              {target === null && session.id === open.at(-1)?.id && (
                <span aria-hidden className="absolute inset-y-1 -right-0.75 w-0.5 rounded-full bg-border-focus" />
              )}
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                title={title}
                className={`flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2.5 text-[13px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus ${
                  pinned ? "pr-2.5" : "pr-7"
                }`}
                onPointerDown={(event) => startDrag(event, session)}
                onClick={() => {
                  if (!dragged.current) {
                    show(session);
                  }

                  dragged.current = false;
                }}
                onDoubleClick={() => setRenaming(session.id)}
                onContextMenu={(event) => openMenu(event, session)}
              >
                <span className="truncate">{title}</span>
                {pinned && <span className="sr-only">{t("agent.tabs.pinned")}</span>}
                {session.answering && (
                  <>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-bg-accent motion-safe:animate-pulse" />
                    <span className="sr-only">{t("agent.sessions.running")}</span>
                  </>
                )}
              </button>
              {!pinned && (
                <button
                  type="button"
                  aria-label={t("agent.tabs.close", { title })}
                  className="absolute right-1 grid size-5 place-items-center rounded-sm text-icon-muted opacity-0 transition-opacity duration-120 group-hover:opacity-100 hover:bg-overlay-hover hover:text-icon-base focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-border-focus"
                  onClick={() => closeSession(session)}
                >
                  <Icon icon="xmark-small" size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!project.missing && (
        <IconButton
          icon="plus"
          label={t("agent.tabs.new", { project: project.name })}
          disabled={newSession.isPending}
          onClick={() => newSession.mutate(project.id, { onSuccess: () => void navigate({ to: "/" }) })}
        />
      )}
      {newSession.isError && (
        <p role="alert" className="shrink-0 text-[12px] text-state-fg-danger">
          {t("agent.sessions.newFailed")}
        </p>
      )}
      {rename.isError && (
        <p role="alert" className="shrink-0 text-[12px] text-state-fg-danger">
          {t("agent.tabs.renameFailed")}
        </p>
      )}
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} items={items(menu.session)} onClose={() => setMenu(null)} />}
    </nav>
  );
}
