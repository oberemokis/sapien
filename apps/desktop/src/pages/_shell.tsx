import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { SessionList, SessionSearch, useActionTriggers, useAttach } from "@/modules/agent";
import { Workspace } from "@/modules/layout";
import { SettingsButton } from "@/modules/settings";

export const Route = createFileRoute("/_shell")({ component: Shell });

// Главный экран: слева поиск, действия, входящие и проекты с сессиями,
// посередине выбранное. Клавиши и расписание действий работают, пока
// открыт любой из его экранов.
function Shell() {
  const navigate = useNavigate();
  const showChat = useCallback(() => void navigate({ to: "/" }), [navigate]);
  const { deferred } = useActionTriggers({ onRun: showChat });

  useAttach();

  return (
    <>
      <Workspace files={<SessionList deferred={deferred} />} main={<Outlet />} actions={<SettingsButton />} />
      <SessionSearch />
    </>
  );
}
