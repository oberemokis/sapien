import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SessionList, SessionSearch, SessionTabs, useAgentEvents } from "@/modules/agent";
import { Workspace } from "@/modules/layout";

export const Route = createFileRoute("/_shell")({ component: Shell });

// Главный экран: слева поиск и проекты с сессиями, сверху вкладки
// открытого проекта, посередине выбранное.
function Shell() {
  useAgentEvents();

  return (
    <>
      <Workspace files={<SessionList />} main={<Outlet />} title={<SessionTabs />} />
      <SessionSearch />
    </>
  );
}
