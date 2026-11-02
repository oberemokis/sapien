import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { useRunning } from "../interactions/chat";
import { closeSession, openSession, useNewSession, useProjects, useSessions, useTabs } from "../interactions/sessions";
import type { SessionInfo } from "../model/sessions";

// Вкладки открытого проекта в верхней полосе окна. Вкладка это сессия:
// нажатие открывает её чат, крестик закрывает вкладку, а сессия остаётся
// в списке слева. Ответ идёт и в фоновой вкладке, её отмечает точка.
// «+» начинает новую сессию в этом же проекте. Для чтения с экрана это
// навигация, а не tablist: tablist держит одни вкладки, без крестиков и «+».
export function SessionTabs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tabs = useTabs();
  const sessions = useSessions();
  const projects = useProjects();
  const running = useRunning();
  const newSession = useNewSession();
  const onChat = useRouterState({ select: (state) => state.location.pathname === "/" });
  const project = projects.data?.find((candidate) => candidate.id === tabs.project);

  if (project === undefined) {
    return null;
  }

  const open = tabs.sessions.flatMap((id) => sessions.data?.filter((session) => session.id === id) ?? []);

  function show(session: SessionInfo) {
    openSession(session);
    void navigate({ to: "/" });
  }

  return (
    <nav aria-label={t("agent.tabs.label", { project: project.name })} className="flex min-w-0 items-center gap-1">
      <ul className="flex min-w-0 items-center gap-1">
        {open.map((session) => {
          const selected = onChat && session.id === tabs.active;
          const title = session.title || t("agent.sessions.untitled");

          return (
            <li
              key={session.id}
              className={`group relative flex h-7 min-w-0 max-w-52 shrink items-center rounded-md transition-colors duration-120 ${
                selected ? "bg-overlay-pressed text-text-base" : "text-text-muted hover:bg-overlay-hover hover:text-text-base"
              }`}
            >
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                title={title}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-7 pl-2.5 text-[13px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
                onClick={() => show(session)}
              >
                <span className="truncate">{title}</span>
                {running(session.id) && (
                  <>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-bg-accent motion-safe:animate-pulse" />
                    <span className="sr-only">{t("agent.sessions.running")}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                aria-label={t("agent.tabs.close", { title })}
                className="absolute right-1 grid size-5 place-items-center rounded-sm text-icon-muted opacity-0 transition-opacity duration-120 group-hover:opacity-100 hover:bg-overlay-hover hover:text-icon-base focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-border-focus"
                onClick={() => closeSession(session)}
              >
                <Icon icon="xmark-small" size={14} />
              </button>
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
    </nav>
  );
}
