import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettings } from "@/modules/appearance";
import { EditorModeSetting } from "@/modules/editor";
import { TagPanelSetting } from "@/modules/vault";

export const Route = createFileRoute("/settings/appearance")({ component: Appearance });

// Тема из модуля appearance, режим редактора из editor, панель тегов из
// vault: соседей связывает страница.
function Appearance() {
  return (
    <AppearanceSettings>
      <EditorModeSetting />
      <TagPanelSetting />
    </AppearanceSettings>
  );
}
