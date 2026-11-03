import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { ContextMenu, type MenuItem } from "@/core/ui/context-menu";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { shortcutLabel } from "@/core/ui/keys";
import {
  openSearch,
  openSession,
  useAddProject,
  useDeleteSession,
  useNewSession,
  useProjects,
  useRemoveProject,
  useSessions,
  useTabs,
} from "../interactions/sessions";
import { agentNames, sessionsOf, type Project, type SessionInfo } from "../model/sessions";

// Строка панели как строка дерева: 28 px, выбранная на заливке.
const ROW_SHAPE =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[13px]/4 outline-none transition-colors duration-120 hover:bg-overlay-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus aria-[current=page]:bg-overlay-pressed [&_svg]:text-icon-muted";

// Разделы панели бледные, сессии ярче имени своего проекта.
const ROW = `${ROW_SHAPE} text-text-muted hover:text-text-base aria-[current=page]:text-text-base`;
const SESSION_ROW = `${ROW_SHAPE} text-text-base`;

// Ветка дерева от буквы проекта к сессии, углы прямые. Список сдвинут
// под середину буквы, у каждой сессии свой отрезок вертикали и отвод
// на середине строки: у последней вертикаль кончается на отводе.
// Отрезки не перекрываются, поэтому полупрозрачная линия ровная.
const SESSION_BRANCH =
  "relative pl-2 before:absolute before:-top-0.5 before:bottom-0 before:left-0 before:w-px before:bg-border-base first:before:-top-1 last:before:bottom-3.5 after:absolute after:top-3.5 after:left-0 after:h-px after:w-2 after:bg-border-base";

type Menu = { x: number; y: number; items: MenuItem[] };

type ProjectProps = {
  project: Project;
  onMenu: (event: MouseEvent, items: MenuItem[]) => void;
};

// Проект и его сессии, свежие сверху. Над сессиями мелкая шапка: буква
// и имя проекта, от буквы к сессиям идут линии дерева. Сессия открывается
// вкладкой своего проекта. Правая кнопка
// открывает меню проекта или сессии.
function ProjectSessions({ project, onMenu }: ProjectProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useSessions();
  const tabs = useTabs();
  const newSession = useNewSession();
  const remove = useRemoveProject();
  const deleteSession = useDeleteSession();
  const onChat = useRouterState({ select: (state) => state.location.pathname === "/" });
  const [removing, setRemoving] = useState(false);
  const list = sessionsOf(sessions.data ?? [], project.id);

  function open(session: SessionInfo) {
    openSession(session);
    void navigate({ to: "/" });
  }

  const projectMenu: MenuItem[] = [
    {
      label: t("agent.sessions.new"),
      disabled: project.missing,
      onSelect: () => newSession.mutate(project.id, { onSuccess: () => void navigate({ to: "/" }) }),
    },
    { label: t("agent.projects.remove"), separated: true, onSelect: () => setRemoving(true) },
  ];

  return (
    <li className="flex flex-col">
      <div
        title={project.path}
        className="flex h-6 items-center gap-2 px-2 text-[12px]/4 text-text-faint"
        onContextMenu={(event) => onMenu(event, projectMenu)}
      >
        <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-overlay-pressed text-[10px] font-medium text-text-muted uppercase">
          {project.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {project.missing && <span className="shrink-0">{t("agent.projects.missing")}</span>}
      </div>
      {removing && (
        <div role="alert" className="mx-1 my-1 flex flex-col gap-2 rounded-md bg-bg-layer-01 p-2 text-[13px]/5 shadow-[inset_0_0_0_0.5px_var(--border-border-muted)]">
          <p>{t("agent.projects.removeAsk")}</p>
          <div className="flex gap-2">
            <Button
              disabled={remove.isPending}
              onClick={() => remove.mutate(project.id, { onSuccess: () => setRemoving(false) })}
            >
              {t("agent.projects.removeYes")}
            </Button>
            <Button onClick={() => setRemoving(false)}>{t("agent.projects.removeNo")}</Button>
          </div>
          {remove.isError && <p className="text-state-fg-danger">{t("agent.projects.removeFailed")}</p>}
        </div>
      )}
      {newSession.isError && (
        <p role="alert" className="px-2 pb-1 text-[12px]/[18px] text-state-fg-danger">
          {t("agent.sessions.newFailed")}
        </p>
      )}
      {deleteSession.isError && (
        <p role="alert" className="px-2 pb-1 text-[12px]/[18px] text-state-fg-danger">
          {t("agent.sessions.deleteFailed")}
        </p>
      )}
      <ul className="ml-4 flex flex-col gap-0.5">
        {list.map((session) => (
          <li key={session.id} className={SESSION_BRANCH}>
            <button
              type="button"
              aria-current={(onChat && session.project === tabs.project && session.id === tabs.active && "page") || undefined}
              className={SESSION_ROW}
              onClick={() => open(session)}
              // Сессию, в которой отвечает агент, Rust не удалит: пункт
              // недоступен и говорит почему.
              onContextMenu={(event) =>
                onMenu(event, [
                  {
                    label: t("agent.sessions.delete"),
                    disabled: session.answering,
                    hint: session.answering ? t("agent.sessions.running") : undefined,
                    onSelect: () => deleteSession.mutate(session),
                  },
                ])
              }
            >
              <span className="min-w-0 flex-1 truncate text-left">{session.title || t("agent.sessions.untitled")}</span>
              {session.agents.length > 0 && (
                <span className="shrink-0 text-[12px] text-text-muted">{agentNames(session)}</span>
              )}
              {session.answering && (
                <>
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-bg-accent motion-safe:animate-pulse" />
                  <span className="sr-only">{t("agent.sessions.running")}</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

// Левая панель: поиск, действия и входящие всегда наверху, ниже проекты
// с их сессиями. deferred это действия по расписанию, которые ждут сети
// или проекта.
export function SessionList({ deferred }: { deferred: string[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useProjects();
  const add = useAddProject();
  const [menu, setMenu] = useState<Menu | null>(null);

  function addProject() {
    add.mutate(undefined, { onSuccess: () => void navigate({ to: "/" }) });
  }

  function openMenu(event: MouseEvent, items: MenuItem[]) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label={t("agent.sessions.sections")} className="flex shrink-0 flex-col gap-0.5 px-1 pt-0.5">
        <button type="button" className={ROW} onClick={openSearch}>
          <Icon icon="magnifying-glass" className="shrink-0" />
          <span className="flex-1 text-left">{t("agent.search.open")}</span>
          <kbd className="font-sans text-[11px] text-text-faint">{shortcutLabel("K")}</kbd>
        </button>
        <Link to="/actions" className={ROW}>
          <Icon icon="task" className="shrink-0" />
          {t("agent.actions.title")}
        </Link>
        <Link to="/inbox" className={ROW}>
          <Icon icon="archive" className="shrink-0" />
          {t("inbox.title")}
        </Link>
      </nav>
      <div className="mt-3 flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-muted">{t("agent.projects.title")}</span>
        <IconButton icon="folder-add-left" label={t("agent.projects.add")} onClick={addProject} />
      </div>
      {add.isError && (
        <p role="alert" className="px-3 pb-1 text-[12px]/[18px] text-state-fg-danger">
          {t("agent.projects.addFailed")}
        </p>
      )}
      <nav aria-label={t("agent.sessions.title")} className="min-h-0 flex-1 overflow-y-auto p-1 pt-0">
        {projects.data?.length === 0 && <p className="p-2 text-[13px]/5 text-text-muted">{t("agent.projects.empty")}</p>}
        <ul className="flex flex-col gap-3">
          {projects.data?.map((project) => (
            <ProjectSessions key={project.id} project={project} onMenu={openMenu} />
          ))}
        </ul>
      </nav>
      {deferred.length > 0 && (
        <output className="m-1 block rounded-md bg-state-bg-warning px-2 py-1.5 text-[12px]/[18px] shadow-[inset_0_0_0_0.5px_var(--state-border-warning)]">
          {t("agent.actions.deferred", { names: deferred.join(", ") })}
        </output>
      )}
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
