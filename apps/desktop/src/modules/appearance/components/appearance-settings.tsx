import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "@/core/ui/segmented";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { setThemePreference, useThemePreference } from "../interactions/theme";
import { THEME_PREFERENCES } from "../model/theme";

// Раздел «Внешний вид». Выбор применяется сразу, кнопки «Сохранить» нет.
// Строки других модулей, например панели тегов, страница ставит в children.
export function AppearanceSettings({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const preference = useThemePreference();

  return (
    <SettingsSection title={t("appearance.title")} description={t("appearance.description")}>
      <SettingsGroup>
        <SettingsRow title={t("appearance.theme.title")} description={t("appearance.theme.description")}>
          <Segmented
            label={t("appearance.theme.title")}
            value={preference}
            options={THEME_PREFERENCES.map((value) => ({ value, label: t(`appearance.theme.${value}`) }))}
            onChange={setThemePreference}
          />
        </SettingsRow>
        {children}
      </SettingsGroup>
    </SettingsSection>
  );
}
