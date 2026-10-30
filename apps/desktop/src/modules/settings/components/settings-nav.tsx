import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/core/ui/icon";
import { useCloseSettings } from "./navigation";
import { SETTINGS_GROUPS } from "./sections";

const ROW = "flex h-8 items-center gap-2 rounded-md px-2.5 text-sm transition-colors duration-120";

// Список разделов слева, внизу «Назад». Раздел сменяет предыдущий в истории,
// а не встаёт поверх: тогда «Назад» уводит с настроек за один шаг.
export function SettingsNav() {
  const { t } = useTranslation();
  const close = useCloseSettings();

  return (
    <div className="flex min-h-0 flex-1 flex-col px-1 pb-1">
      <nav aria-label={t("settings.sections")} className="flex flex-1 flex-col gap-4 overflow-y-auto pt-2">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="px-2.5 pb-1 text-xs text-content/50">{t(group.label)}</p>
            {group.sections.map((section) => (
              <Link
                key={section.to}
                to={section.to}
                replace
                className={`${ROW} text-content/70 hover:bg-selection-hover hover:text-content aria-[current=page]:bg-selection aria-[current=page]:text-content`}
              >
                <Icon icon={section.icon} />
                {t(section.label)}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <button type="button" className={`${ROW} text-content/70 hover:bg-selection-hover hover:text-content`} onClick={close}>
        <Icon icon={ArrowLeft01Icon} />
        {t("settings.back")}
      </button>
    </div>
  );
}
