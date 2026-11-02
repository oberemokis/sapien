import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { useAddProject, useNewSession, useProjects, useSelectedSession, useSessions } from "../interactions/sessions";
import { homeProject } from "../model/sessions";
import { AgentChat } from "./agent-chat";

// Без открытой сессии: первый шаг, добавить папку проекта, или новая
// сессия в последнем проекте.
function Welcome() {
  const { t } = useTranslation();
  const projects = useProjects();
  const sessions = useSessions();
  const add = useAddProject();
  const newSession = useNewSession();
  const project = homeProject(projects.data ?? [], sessions.data ?? [], null);

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

// Середина главного экрана: чат открытой сессии. Свой чат у каждой
// сессии: недописанное сообщение не переезжает в другую.
export function SessionView() {
  const selected = useSelectedSession();
  const sessions = useSessions();
  const projects = useProjects();
  const session = sessions.data?.find((candidate) => candidate.id === selected);

  if (session === undefined) {
    return <Welcome />;
  }

  return (
    <AgentChat
      key={session.id}
      session={session}
      project={projects.data?.find((project) => project.id === session.project)}
    />
  );
}
