import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SettingsNav, useCloseOnEscape } from "@/modules/settings";

export const Route = createFileRoute("/settings")({ component: Settings });

// Настройки занимают всё окно, как в opencode: слева колонка разделов,
// справа выбранный. Полоса сверху держит окно за перетаскивание и место
// под кнопки окна.
function Settings() {
  useCloseOnEscape();

  return (
    <div className="flex h-full flex-col bg-bg-base">
      <div data-tauri-drag-region className="h-8 shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-260 gap-14 px-12 pb-16">
          <SettingsNav />
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
