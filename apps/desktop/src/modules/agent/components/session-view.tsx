import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { useClaudeStatus } from "../interactions/claude";
import { useActiveSession, useAddProject, useNewSession, useProjects, useSessions, useTabs } from "../interactions/sessions";
import { homeProject } from "../model/sessions";

// Действие внутри плашки, как link-action дизайн-системы.
const LINK =
  "shrink-0 text-[13px] font-medium underline decoration-text-base/40 underline-offset-2 hover:decoration-text-base";

// Плашка, как Banner дизайн-системы: агенту нечем или негде работать.
function Notice({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="mx-auto mt-4 flex w-full max-w-200 items-center gap-3 rounded-md bg-state-bg-danger px-3 py-2 text-[13px]/5 shadow-[inset_0_0_0_0.5px_var(--state-border-danger)]"
    >
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}

// Без открытых вкладок: первый шаг, добавить папку проекта, или новая
// сессия в открытом проекте, а без него в последнем.
function Welcome() {
  const { t } = useTranslation();
  const projects = useProjects();
  const sessions = useSessions();
  const tabs = useTabs();
  const add = useAddProject();
  const newSession = useNewSession();
  const current = projects.data?.find((project) => project.id === tabs.project && !project.missing);
  const project = current?.id ?? homeProject(projects.data ?? [], sessions.data ?? [], null);

  if (projects.data === undefined) {
    return null;
  }

  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Icon icon="bubble-5" size={20} className="text-icon-muted" />
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-[16px]/7 font-medium">
            {project === null ? t("agent.welcome.firstTitle") : t("agent.welcome.title")}
          </h1>
          <p className="text-[13px]/5 text-text-muted">
            {project === null ? t("agent.welcome.firstText") : t("agent.welcome.text")}
          </p>
        </div>
        {project === null ? (
          <Button variant="submit" disabled={add.isPending} onClick={() => add.mutate()}>
            {t("agent.projects.add")}
          </Button>
        ) : (
          <Button variant="submit" disabled={newSession.isPending} onClick={() => newSession.mutate(project)}>
            {t("agent.sessions.new")}
          </Button>
        )}
        {(add.isError || newSession.isError) && (
          <p role="alert" className="text-[13px] text-state-fg-danger">
            {t("agent.projects.addFailed")}
          </p>
        )}
      </div>
    </div>
  );
}

// Середина главного экрана: сессия активной вкладки. Агенту нечем или
// негде работать, Claude Code не готов или папки проекта больше нет:
// плашка говорит, что не так.
export function SessionView() {
  const { t } = useTranslation();
  const session = useActiveSession();
  const projects = useProjects();
  const claude = useClaudeStatus();

  if (session === null) {
    return <Welcome />;
  }

  const project = projects.data?.find((candidate) => candidate.id === session.project);
  const claudeState = claude.status?.state;
  let notice: ReactNode = null;

  if (claudeState !== undefined && claudeState !== "ready") {
    notice = (
      <Notice
        action={
          <Link to="/settings/agent" className={LINK}>
            {t("agent.session.setUpClaude")}
          </Link>
        }
      >
        {t(`agent.settings.claude.${claudeState}`)}
      </Notice>
    );
  }

  if (projects.data !== undefined && (project === undefined || project.missing)) {
    notice = <Notice>{t("agent.session.projectMissing", { path: project?.path ?? "" })}</Notice>;
  }

  return <div className="flex min-h-0 flex-1 flex-col px-4">{notice}</div>;
}
