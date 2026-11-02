import { Outlet, createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/modules/layout";
import { SettingsNav, SettingsTitle, useCloseOnEscape } from "@/modules/settings";

export const Route = createFileRoute("/settings")({ component: Settings });

// Настройки занимают окно вместо основного вида: та же раскладка, слева
// разделы, посередине выбранный, чата нет.
function Settings() {
  useCloseOnEscape();

  return (
    <Workspace
      files={<SettingsNav />}
      main={
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      }
      title={<SettingsTitle />}
    />
  );
}
