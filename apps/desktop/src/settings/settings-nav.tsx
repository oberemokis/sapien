import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@sapien/ui";
import { useCloseSettings } from "./navigation";
import { SECTION_NAMESPACES, SETTINGS_GROUPS } from "./sections";

// Строка раздела как строка дерева: 28 px, бледная, выбранная на заливке.
const ROW =
  "flex h-7 items-center gap-2 rounded-md px-2 text-[13px]/4 text-text-muted outline-none transition-colors duration-120 hover:bg-overlay-hover hover:text-text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus [&_svg]:text-icon-muted";

// Список разделов слева, внизу «Назад». Раздел сменяет предыдущий в истории,
// а не встаёт поверх: тогда «Назад» уводит с настроек за один шаг.
export function SettingsNav() {
  const { t } = useTranslation(SECTION_NAMESPACES);
  const close = useCloseSettings();

  return (
    <div className="flex min-h-0 flex-1 flex-col px-1 pb-1">
      <nav aria-label={t("settings.sections")} className="flex flex-1 flex-col gap-4 overflow-y-auto pt-2">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="flex h-7 items-center px-2 text-[11px] font-medium text-text-faint">{t(group.label)}</p>
            {group.sections.map((section) => (
              <Link
                key={section.to}
                to={section.to}
                replace
                className={`${ROW} aria-[current=page]:bg-overlay-pressed aria-[current=page]:text-text-base aria-[current=page]:[&_svg]:text-icon-base`}
              >
                <Icon icon={section.icon} />
                {t(section.label)}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <button type="button" className={ROW} onClick={close}>
        <Icon icon="chevron-left" />
        {t("settings.back")}
      </button>
    </div>
  );
}
