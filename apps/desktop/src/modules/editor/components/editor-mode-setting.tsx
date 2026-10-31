import { useTranslation } from "react-i18next";
import { Segmented } from "@/core/ui/segmented";
import { SettingsRow } from "@/core/ui/settings";
import { setEditorMode, useEditorMode } from "../interactions/editor-mode";
import { EDITOR_MODES } from "../model/mode";

// Строка «Редактор» для раздела «Внешний вид».
export function EditorModeSetting() {
  const { t } = useTranslation();
  const mode = useEditorMode();

  return (
    <SettingsRow title={t("editor.mode.title")} description={t("editor.mode.description")}>
      <Segmented
        label={t("editor.mode.title")}
        value={mode}
        options={EDITOR_MODES.map((value) => ({ value, label: t(`editor.mode.${value}`) }))}
        onChange={setEditorMode}
      />
    </SettingsRow>
  );
}
