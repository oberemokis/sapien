import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { useActiveSession, useAddProject, useNewSession, useProjects, useSessions, useTabs } from "../interactions/sessions";
import { attachTerminal, restartTerminal, useTerminalState } from "../interactions/terminal";
import { homeProject, type SessionInfo } from "../model/sessions";

// Действие внутри плашки, как link-action дизайн-системы.
const LINK =
  "shrink-0 text-[13px] font-medium underline decoration-text-base/40 underline-offset-2 hover:decoration-text-base";

const TONES = {
  danger: "bg-state-bg-danger shadow-[inset_0_0_0_0.5px_var(--state-border-danger)]",
  warning: "bg-state-bg-warning shadow-[inset_0_0_0_0.5px_var(--state-border-warning)]",
};

type NoticeProps = { children: string; action?: ReactNode; tone?: keyof typeof TONES };

// Плашка, как Banner дизайн-системы: терминалу негде работать или с ним
// что-то случилось.
function Notice({ children, action, tone = "danger" }: NoticeProps) {
  return (
    <div
      role="alert"
      className={`mx-auto mt-4 flex w-full max-w-200 items-center gap-3 rounded-md px-3 py-2 text-[13px]/5 ${TONES[tone]}`}
    >
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}

// Терминал сессии. Вкладка, которую закрыли с экрана переходом на другую,
// при возврате видит тот же терминал. Начатый заново терминал получает
// новое место на странице.
function SessionTerminal({ session }: { session: SessionInfo }) {
  const { t } = useTranslation();
  const { notice, generation } = useTerminalState(session.id);
  const attach = useCallback((host: HTMLDivElement) => attachTerminal(session.id, host), [session.id]);

  function restart(label: string) {
    return (
      <button type="button" className={LINK} onClick={() => restartTerminal(session.id)}>
        {label}
      </button>
    );
  }

  return (
    <>
      {notice === "exited" && (
        <Notice tone="warning" action={restart(t("agent.terminal.restart"))}>
          {t("agent.terminal.exited")}
        </Notice>
      )}
      {notice === "failed" && <Notice action={restart(t("agent.terminal.retry"))}>{t("agent.terminal.failed")}</Notice>}
      <div key={generation} ref={attach} data-testid="terminal" className="min-h-0 flex-1 py-2" />
    </>
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

// Середина главного экрана: терминал сессии активной вкладки. Папки
// проекта больше нет, и вместо терминала плашка говорит об этом.
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
      {project !== undefined && <SessionTerminal session={session} />}
    </div>
  );
}
