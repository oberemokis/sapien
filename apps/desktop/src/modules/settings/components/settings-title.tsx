import { useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SETTINGS_GROUPS } from "./sections";

// Группы разной длины, и без явного типа flatMap не сводит их разделы
// в один список.
type Section = (typeof SETTINGS_GROUPS)[number]["sections"][number];

// Путь «Настройки / Раздел» в верхней полосе окна.
export function SettingsTitle() {
  const { t } = useTranslation();
  const matchRoute = useMatchRoute();
  const current = SETTINGS_GROUPS.flatMap<Section>((group) => group.sections).find(
    (section) => matchRoute({ to: section.to }) !== false,
  );

  return (
    <p className="flex min-w-0 items-center gap-1.5 truncate text-[13px]">
      <span className="text-text-muted">{t("settings.title")}</span>
      {current !== undefined && (
        <>
          <span aria-hidden className="text-text-faint">
            /
          </span>
          <span>{t(current.label)}</span>
        </>
      )}
    </p>
  );
}
