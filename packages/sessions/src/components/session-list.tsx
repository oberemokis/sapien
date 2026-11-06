import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { agentName } from "@sapien/agents";
import { ProjectHeader, ProjectList, ProjectsHeader, RemoveProject } from "@sapien/projects";
import { ContextMenu, Icon, type MenuItem, shortcutLabel, useReorder } from "@sapien/ui";
import { focusPane, panesIn, usePanes } from "@sapien/terminal";
import {
  openSearch,
  openSession,
  placeSession,
  toggleAgents,
  useCollapsed,
  useDeleteSession,
  useNewSession,
  useProjectSessions,
  useRefreshSessions,
  useRenameSession,
  useStartSession,
  useTabs,
} from "../interactions/sessions";
import type { Project, SessionInfo } from "@sapien/ipc";
import { moveSession } from "../model/sessions";
import { RenameField } from "./rename-field";

// Строка панели как строка дерева: 28 px, выбранная на заливке.
const ROW_SHAPE =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[13px]/4 outline-none transition-colors duration-120 hover:bg-overlay-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus aria-[current=page]:bg-overlay-pressed [&_svg]:text-icon-muted";

// Разделы панели бледные, сессии ярче имени своего проекта. Сессию
// перетаскивают, и текст под указателем не выделяется.
const ROW = `${ROW_SHAPE} text-text-muted hover:text-text-base aria-[current=page]:text-text-base`;
const SESSION_ROW = `${ROW_SHAPE} text-text-base select-none`;
const AGENT_ROW = `${ROW_SHAPE} text-text-muted hover:text-text-base`;

// Ветка дерева от буквы проекта к сессии, углы прямые. Список сдвинут
// под середину буквы, у каждой сессии свой отрезок вертикали и отвод
// на середине строки: у последней вертикаль кончается на отводе, ниже
// него могут идти её агенты. Отрезки не перекрываются, поэтому
// полупрозрачная линия ровная.
const SESSION_BRANCH =
  "relative pl-2 before:absolute before:-top-0.5 before:bottom-0 before:left-0 before:w-px before:bg-border-base first:before:-top-1 last:before:h-4 first:last:before:h-4.5 after:absolute after:top-3.5 after:left-0 after:h-px after:w-2 after:bg-border-base";

// Та же ветка от сессии к её агентам: список висит под первой буквой
// названия сессии.
const AGENT_BRANCH =
  "relative pl-2 before:absolute before:-top-0.5 before:bottom-0 before:left-0 before:w-px before:bg-border-base first:before:top-0 last:before:h-4 first:last:before:h-3.5 after:absolute after:top-3.5 after:left-0 after:h-px after:w-2 after:bg-border-base";

// Агенты в панелях сессии, в порядке панелей. Агент закрытой панели, который
// ещё доделывает работу, идёт последним. Строка открывает сессию и ставит
// фокус в панель агента.
function SessionAgents({ session, onOpen }: { session: SessionInfo; onOpen: (session: SessionInfo) => void }) {
  const { t } = useTranslation("sessions");
  const panes = panesIn(usePanes(session.id).layout);

  if (session.agents.length === 0) {
    return null;
  }

  const place = (pane: string) => (panes.includes(pane) ? panes.indexOf(pane) : panes.length);
  const agents = session.agents.toSorted((a, b) => place(a.pane) - place(b.pane));

  return (
    <ul aria-label={t("sessions.agents", { title: session.title || t("sessions.untitled") })} className="ml-2 flex flex-col gap-0.5">
      {agents.map((running) => (
        <li key={running.pane} className={AGENT_BRANCH}>
          <button
            type="button"
            className={AGENT_ROW}
            onClick={() => {
              onOpen(session);
              focusPane(session.id, running.pane);
            }}
          >
            <span className="min-w-0 flex-1 truncate text-left">{agentName(running.agent)}</span>
            {running.answering && (
              <>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-bg-accent motion-safe:animate-pulse" />
                <span className="sr-only">{t("sessions.running")}</span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

type Menu = { x: number; y: number; items: MenuItem[] };

type ProjectProps = {
  project: Project;
  onMenu: (event: MouseEvent, items: MenuItem[]) => void;
};

// Проект и его сессии, свежие сверху, пока человек не переставил их
// перетаскиванием. Над сессиями мелкая шапка: буква и имя проекта, от
// буквы к сессиям идут линии дерева. Сессия открывается вкладкой своего
// проекта. Правая кнопка открывает меню проекта или сессии, двойное
// нажатие переименовывает сессию, как во вкладках.
function ProjectSessions({ project, onMenu }: ProjectProps) {
  const { t } = useTranslation(["sessions", "projects"]);
  const navigate = useNavigate();
  const tabs = useTabs();
  const newSession = useNewSession();
  const refreshSessions = useRefreshSessions();
  const deleteSession = useDeleteSession();
  const rename = useRenameSession();
  const onChat = useRouterState({ select: (state) => state.location.pathname === "/" });
  const [removing, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const shown = useProjectSessions(project.id);
  const collapsed = useCollapsed();
  const ids = shown.map((session) => session.id);
  const { list, drop, start, pressed } = useReorder("y", ({ id, before }) => placeSession(project.id, ids, id, before));
  let target: string | null | undefined;

  // Черта показывает, куда встанет сессия: перед той, что окажется за ней.
  if (drop !== null) {
    const order = moveSession(ids, drop.id, drop.before);

    if (order.join() !== ids.join()) {
      target = order[order.indexOf(drop.id) + 1] ?? null;
    }
  }

  function open(session: SessionInfo) {
    openSession(session);
    void navigate({ to: "/" });
  }

  function finishRename(session: SessionInfo, title: string | null) {
    setRenaming(null);

    if (title !== null && title.trim() !== session.title) {
      rename.mutate({ id: session.id, title });
    }
  }

  const projectMenu: MenuItem[] = [
    {
      label: t("sessions.new"),
      disabled: project.missing,
      onSelect: () => newSession.mutate(project.id, { onSuccess: () => void navigate({ to: "/" }) }),
    },
    { label: t("projects:remove"), separated: true, critical: true, onSelect: () => setRemoving(true) },
  ];

  return (
    <li className="flex flex-col">
      <ProjectHeader project={project} onContextMenu={(event) => onMenu(event, projectMenu)} />
      {removing && <RemoveProject project={project} onRemoved={refreshSessions} onClose={() => setRemoving(false)} />}
      {newSession.isError && (
        <p role="alert" className="px-2 pb-1 text-[12px]/[18px] text-state-fg-danger">
          {t("sessions.newFailed")}
        </p>
      )}
      {deleteSession.isError && (
        <p role="alert" className="px-2 pb-1 text-[12px]/[18px] text-state-fg-danger">
          {t("sessions.deleteFailed")}
        </p>
      )}
      {rename.isError && (
        <p role="alert" className="px-2 pb-1 text-[12px]/[18px] text-state-fg-danger">
          {t("sessions.renameFailed")}
        </p>
      )}
      <ul ref={list} className="ml-4 flex flex-col gap-0.5">
        {shown.map((session) => {
          const title = session.title || t("sessions.untitled");
          const branched = session.agents.length > 0;
          const folded = branched && collapsed.includes(session.id);

          return (
            <li
              key={session.id}
              data-id={session.id}
              className={`group ${SESSION_BRANCH} ${drop?.id === session.id ? "opacity-60" : ""}`}
            >
              {target === session.id && (
                <span aria-hidden className="absolute right-0 left-2 -top-0.5 h-0.5 rounded-full bg-border-focus" />
              )}
              {target === null && session.id === ids.at(-1) && (
                <span aria-hidden className="absolute right-0 -bottom-0.5 left-2 h-0.5 rounded-full bg-border-focus" />
              )}
              {renaming === session.id ? (
                <RenameField
                  title={session.title}
                  label={t("sessions.name")}
                  className="w-full px-2"
                  onDone={(next) => finishRename(session, next)}
                />
              ) : (
                <button
                  type="button"
                  aria-current={(onChat && session.project === tabs.project && session.id === tabs.active && "page") || undefined}
                  className={`${SESSION_ROW} ${branched ? "pr-7" : ""}`}
                  onPointerDown={(event) => start(event, session.id)}
                  onClick={() => {
                    if (pressed()) {
                      open(session);
                    }
                  }}
                  onDoubleClick={() => setRenaming(session.id)}
                  // Сессию, в которой отвечает агент, Rust не удалит: пункт
                  // недоступен и говорит почему.
                  onContextMenu={(event) =>
                    onMenu(event, [
                      { label: t("sessions.rename"), onSelect: () => setRenaming(session.id) },
                      {
                        label: t("sessions.delete"),
                        separated: true,
                        critical: true,
                        disabled: session.answering,
                        hint: session.answering ? t("sessions.running") : undefined,
                        onSelect: () => deleteSession.mutate(session),
                      },
                    ])
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-left">{title}</span>
                  {/* Свёрнутая ветка не прячет, что агент работает. */}
                  {folded && session.answering && (
                    <>
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-bg-accent motion-safe:animate-pulse" />
                      <span className="sr-only">{t("sessions.running")}</span>
                    </>
                  )}
                </button>
              )}
              {/* Свёрнутая ветка держит шеврон на виду, раскрытая показывает его
                  при наведении. */}
              {branched && renaming !== session.id && (
                <button
                  type="button"
                  aria-expanded={!folded}
                  aria-label={t(folded ? "sessions.expand" : "sessions.collapse", { title })}
                  className={`absolute top-1 right-1 grid size-5 place-items-center rounded-sm text-icon-muted transition-opacity duration-120 group-hover:opacity-100 hover:bg-overlay-hover hover:text-icon-base focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-border-focus ${
                    folded ? "" : "opacity-0"
                  }`}
                  onClick={() => toggleAgents(session.id)}
                >
                  <Icon
                    icon="chevron-down"
                    size={14}
                    className={`transition-transform duration-120 ${folded ? "-rotate-90" : ""}`}
                  />
                </button>
              )}
              {!folded && <SessionAgents session={session} onOpen={open} />}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

// Левая панель: поиск всегда наверху, ниже проекты с их сессиями.
export function SessionList() {
  const { t } = useTranslation("sessions");
  const navigate = useNavigate();
  const startSession = useStartSession();
  const [menu, setMenu] = useState<Menu | null>(null);

  async function startIn(project: Project) {
    await startSession(project);
    void navigate({ to: "/" });
  }

  function openMenu(event: MouseEvent, items: MenuItem[]) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label={t("sessions.sections")} className="flex shrink-0 flex-col gap-0.5 px-1 pt-0.5">
        <button type="button" className={ROW} onClick={openSearch}>
          <Icon icon="magnifying-glass" className="shrink-0" />
          <span className="flex-1 text-left">{t("search.open")}</span>
          <kbd className="font-sans text-[11px] text-text-faint">{shortcutLabel("K")}</kbd>
        </button>
      </nav>
      <ProjectsHeader onAdded={startIn} />
      <nav aria-label={t("sessions.title")} className="min-h-0 flex-1 overflow-y-auto p-1 pt-0">
        <ProjectList>{(project) => <ProjectSessions key={project.id} project={project} onMenu={openMenu} />}</ProjectList>
      </nav>
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
