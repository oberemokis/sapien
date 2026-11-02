import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  SessionList,
  SessionSearch,
  SessionTabs,
  useActionTriggers,
  useAgentEvents,
} from "@/modules/agent";
import { Workspace } from "@/modules/layout";

export const Route = createFileRoute("/_shell")({ component: Shell });

// Главный экран: слева поиск, действия, входящие и проекты с сессиями,
// сверху вкладки открытого проекта, посередине выбранное. Клавиши
// и расписание действий работают, пока открыт любой из его экранов.
function Shell() {
  const navigate = useNavigate();
  const showTabs = useCallback(() => void navigate({ to: "/" }), [navigate]);
  const { deferred } = useActionTriggers({ onRun: showTabs });

  useAgentEvents();

  return (
    <>
      <Workspace
        files={<SessionList deferred={deferred} />}
        main={<Outlet />}
        title={<SessionTabs />}
      />
      <SessionSearch />
    </>
  );
}
