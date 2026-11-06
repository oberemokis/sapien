import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Restoring, SessionList, SessionSearch, SessionTabs, useAgentEvents, useRestoredTabs } from "@sapien/sessions";
import { Workspace } from "@sapien/layout";

export const Route = createFileRoute("/_shell")({ component: Shell });

// Главный экран: слева поиск и проекты с сессиями, сверху вкладки
// открытого проекта, посередине выбранное. При открытии окна сначала
// поднимаются все открытые вкладки, и агенты в них продолжают разговоры.
function Shell() {
  const ready = useRestoredTabs();

  useAgentEvents();

  if (!ready) {
    return <Restoring />;
  }

  return (
    <>
      <Workspace files={<SessionList />} main={<Outlet />} title={<SessionTabs />} />
      <SessionSearch />
    </>
  );
}
