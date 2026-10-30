import { useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SETTINGS_GROUPS } from "./sections";

// Путь «Настройки / Раздел» в верхней полосе окна.
export function SettingsTitle() {
  const { t } = useTranslation();
  const matchRoute = useMatchRoute();
  const current = SETTINGS_GROUPS.flatMap((group) => group.sections).find(
    (section) => matchRoute({ to: section.to }) !== false,
  );

  return (
    <p className="flex min-w-0 items-center gap-1.5 truncate text-sm">
      <span className="text-content/60">{t("settings.title")}</span>
      {current !== undefined && (
        <>
          <span aria-hidden className="text-content/30">
            /
          </span>
          <span>{t(current.label)}</span>
        </>
      )}
    </p>
  );
}
