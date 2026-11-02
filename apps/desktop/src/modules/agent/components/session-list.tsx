import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import InboxIcon from "@hugeicons/core-free-icons/InboxIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { ContextMenu, type MenuItem } from "@/core/ui/context-menu";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { shortcutLabel } from "@/core/ui/keys";
import { useRunningSession } from "../interactions/chat";
import {
  openSearch,
  selectSession,
  useAddProject,
  useDeleteSession,
  useNewSession,
  useProjects,
  useRemoveProject,
  useSelectedSession,
  useSessions,
} from "../interactions/sessions";
import { sessionsOf, type Project } from "../model/sessions";

// Строка панели как строка дерева: 28 px, бледная, выбранная на заливке.
const ROW =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[13px]/4 text-text-muted outline-none transition-colors duration-120 hover:bg-overlay-hover hover:text-text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus aria-[current=page]:bg-overlay-pressed aria-[current=page]:text-text-base [&_svg]:text-icon-muted";

type Menu = { x: number; y: number; items: MenuItem[] };

type ProjectProps = {
  project: Project;
  onMenu: (event: MouseEvent, items: MenuItem[]) => void;
};

// Проект и его сессии, свежие сверху. «+» начинает новую сессию, правая
// кнопка открывает меню проекта или сессии.
function ProjectSessions({ project, onMenu }: ProjectProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useSessions();
  const selected = useSelectedSession();
  const running = useRunningSession();
  const newSession = useNewSession();
  const remove = useRemoveProject();
  const deleteSession = useDeleteSession();
  const onChat = useRouterState({ select: (state) => state.location.pathname === "/" });
  const [removing, setRemoving] = useState(false);
  const list = sessionsOf(sessions.data ?? [], project.id);

  function create() {
    newSession.mutate(project.id, { onSuccess: () => void navigate({ to: "/" }) });
  }

  function open(id: string) {
    selectSession(id);
    void navigate({ to: "/" });
  }

  const projectMenu: MenuItem[] = [
    { label: t("agent.sessions.new"), disabled: project.missing, onSelect: create },
    { label: t("agent.projects.remove"), separated: true, onSelect: () => setRemoving(true) },
  ];

  return (
    <li className="flex flex-col">
      <div className="group flex h-7 items-center gap-1 pr-0.5" onContextMenu={(event) => onMenu(event, projectMenu)}>
        <p title={project.path} className="flex min-w-0 flex-1 items-center gap-2 px-2 text-[13px]/4 font-medium">
          <Icon icon={Folder01Icon} className="shrink-0 text-icon-muted" />
          <span className="truncate">{project.name}</span>
          {project.missing && <span className="shrink-0 text-[12px] font-normal text-text-faint">{t("agent.projects.missing")}</span>}
        </p>
        {!project.missing && (
          <IconButton icon={PlusSignIcon} label={t("agent.sessions.newIn", { project: project.name })} onClick={create} />
        )}
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
      <ul className="flex flex-col gap-0.5">
        {list.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              aria-current={(onChat && session.id === selected && "page") || undefined}
              className={`${ROW} pl-7`}
              onClick={() => open(session.id)}
              onContextMenu={(event) =>
                onMenu(event, [{ label: t("agent.sessions.delete"), onSelect: () => deleteSession.mutate(session.id) }])
              }
            >
              <span className="min-w-0 flex-1 truncate text-left">{session.title || t("agent.sessions.untitled")}</span>
              {session.id === running && (
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
          <Icon icon={Search01Icon} className="shrink-0" />
          <span className="flex-1 text-left">{t("agent.search.open")}</span>
          <kbd className="font-sans text-[11px] text-text-faint">{shortcutLabel("K")}</kbd>
        </button>
        <Link to="/actions" className={ROW}>
          <Icon icon={FlashIcon} className="shrink-0" />
          {t("agent.actions.title")}
        </Link>
        <Link to="/inbox" className={ROW}>
          <Icon icon={InboxIcon} className="shrink-0" />
          {t("inbox.title")}
        </Link>
      </nav>
      <div className="mt-3 flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-muted">{t("agent.projects.title")}</span>
        <IconButton icon={FolderAddIcon} label={t("agent.projects.add")} onClick={addProject} />
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
