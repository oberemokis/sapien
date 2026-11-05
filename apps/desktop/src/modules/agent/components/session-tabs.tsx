import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useProjects } from "@sapien/projects";
import { ContextMenu, Icon, IconButton, type MenuItem, useReorder } from "@sapien/ui";
import {
  closeSession,
  moveSessionTab,
  openSession,
  pinSession,
  useNewSession,
  useRenameSession,
  useSessions,
  useTabs,
} from "../interactions/sessions";
import type { SessionInfo } from "@sapien/ipc";
import { moveTab } from "../model/tabs";
import { RenameField } from "./rename-field";

type Menu = { x: number; y: number; session: SessionInfo };

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
  const { list, drop, start, pressed } = useReorder("x", ({ id, before }) => {
    if (tabs.project !== null) {
      moveSessionTab({ id, project: tabs.project }, before);
    }
  });
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
    const order = moveTab({ project: project.id, projects: { [project.id]: own } }, project.id, drop.id, drop.before)
      .projects[project.id]?.sessions;

    if (order !== undefined && order.join() !== tabs.sessions.join()) {
      target = order[order.indexOf(drop.id) + 1] ?? null;
    }
  }

  function show(session: SessionInfo) {
    openSession(session);
    void navigate({ to: "/" });
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
              <li key={session.id} data-id={session.id} className="flex shrink-0 items-center">
                <RenameField
                  title={session.title}
                  label={t("agent.tabs.name")}
                  className="w-44 px-2.5"
                  onDone={(next) => finishRename(session, next)}
                />
              </li>
            );
          }

          return (
            <li
              key={session.id}
              data-id={session.id}
              className={`group relative flex h-7 min-w-0 items-center rounded-md transition-colors duration-120 select-none ${
                pinned ? "shrink-0" : "max-w-52 shrink"
              } ${selected ? "bg-overlay-pressed text-text-base" : "text-text-muted hover:bg-overlay-hover hover:text-text-base"} ${
                drop?.id === session.id ? "opacity-60" : ""
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
                onPointerDown={(event) => start(event, session.id)}
                onClick={() => {
                  if (pressed()) {
                    show(session);
                  }
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
