import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ClaudeUsage, SessionList, SessionSearch, SessionTabs } from "@/modules/agent";
import { Workspace } from "@/modules/layout";
import { SettingsButton } from "@/modules/settings";

export const Route = createFileRoute("/_shell")({ component: Shell });

// Главный экран: слева поиск, действия, входящие и проекты с сессиями,
// сверху вкладки открытого проекта, посередине выбранное.
function Shell() {
  return (
    <>
      <Workspace
        files={<SessionList />}
        main={<Outlet />}
        title={<SessionTabs />}
        actions={<SettingsButton />}
        footer={<ClaudeUsage />}
      />
      <SessionSearch />
    </>
  );
}
