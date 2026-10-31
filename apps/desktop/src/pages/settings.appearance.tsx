import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettings } from "@/modules/appearance";
import { TagPanelSetting } from "@/modules/vault";

export const Route = createFileRoute("/settings/appearance")({ component: Appearance });

// Тема из модуля appearance, панель тегов из vault: соседей связывает страница.
function Appearance() {
  return (
    <AppearanceSettings>
      <TagPanelSetting />
    </AppearanceSettings>
  );
}
