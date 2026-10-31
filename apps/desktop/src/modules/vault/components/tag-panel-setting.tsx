import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/core/ui/settings";
import { setTagPanel, useTagPanel } from "../interactions/tag-panel";

// Строка «Панель тегов» для раздела «Внешний вид»: возвращает панель,
// убранную из меню её заголовка. Свёрнутая панель здесь считается
// показанной: свернуть и развернуть можно и щелчком по заголовку.
export function TagPanelSetting() {
  const { t } = useTranslation();
  const panel = useTagPanel();

  return (
    <SettingsRow title={t("vault.tags.panel.title")} description={t("vault.tags.panel.description")}>
      <input
        type="checkbox"
        aria-label={t("vault.tags.panel.show")}
        className="accent-accent"
        checked={panel !== "hidden"}
        onChange={(event) => setTagPanel(event.target.checked ? "open" : "hidden")}
      />
    </SettingsRow>
  );
}
