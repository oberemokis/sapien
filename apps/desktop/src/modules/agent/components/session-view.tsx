import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { useActiveSession, useAddProject, useNewSession, useProjects, useSessions, useTabs } from "../interactions/sessions";
import { homeProject } from "../model/sessions";
import { Notice } from "./notice";
import { SessionPanes } from "./session-panes";

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

// Середина главного экрана: панели сессии активной вкладки. Папки
// проекта больше нет, и вместо панелей плашка говорит об этом.
export function SessionView() {
  const { t } = useTranslation();
  const session = useActiveSession();
  const projects = useProjects();

  if (session === null) {
    return <Welcome />;
  }

  const project = projects.data?.find((candidate) => candidate.id === session.project);

  if (projects.data !== undefined && (project === undefined || project.missing)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-4">
        <Notice>{t("agent.session.projectMissing", { path: project?.path ?? "" })}</Notice>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4">
      {project !== undefined && <SessionPanes session={session.id} />}
    </div>
  );
}
