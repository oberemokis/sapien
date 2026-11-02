import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/core/ui/icon";
import { useCloseSettings } from "./navigation";
import { SETTINGS_GROUPS } from "./sections";

// Строка колонки: 28 px, бледная, выбранная на заливке.
const ROW =
  "flex h-7 items-center gap-2 rounded-md px-2 text-[13px]/4 text-text-muted outline-none transition-colors duration-120 [&_svg]:shrink-0 [&_svg]:text-icon-muted";

const LINK = `${ROW} hover:bg-overlay-hover hover:text-text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus`;

// Колонка настроек, как в opencode: сверху «Назад», под ним поиск и
// разделы группами без подписей. Раздел сменяет предыдущий в истории,
// а не встаёт поверх: тогда «Назад» уводит с настроек за один шаг.
export function SettingsNav() {
  const { t } = useTranslation();
  const close = useCloseSettings();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const groups = SETTINGS_GROUPS.map((group) =>
    group.filter((section) => {
      const haystack = [section.label, ...section.terms].map((key) => t(key)).join(" ").toLowerCase();

      return words.every((word) => haystack.includes(word));
    }),
  ).filter((group) => group.length > 0);

  return (
    <div className="sticky top-0 flex w-52 shrink-0 flex-col gap-8 self-start">
      <button type="button" className={LINK} onClick={close}>
        <Icon icon={ArrowLeft02Icon} />
        {t("settings.back")}
      </button>
      <div className="flex flex-col gap-2.5">
        <label className={`${ROW} focus-within:text-text-base`}>
          <Icon icon={Search01Icon} />
          <input
            type="search"
            aria-label={t("settings.search")}
            placeholder={t("settings.search")}
            value={query}
            className="min-w-0 flex-1 bg-transparent text-text-base outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape сначала стирает запрос и только потом уводит с настроек.
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                setQuery("");
              }

              const first = groups[0]?.[0];

              if (event.key === "Enter" && first !== undefined) {
                void navigate({ to: first.to, replace: true });
              }
            }}
          />
        </label>
        <nav aria-label={t("settings.sections")} className="flex flex-col gap-2.5">
          {groups.map((group) => (
            <div key={group[0].to} className="flex flex-col">
              {group.map((section) => (
                <Link
                  key={section.to}
                  to={section.to}
                  replace
                  className={`${LINK} aria-[current=page]:bg-overlay-pressed aria-[current=page]:text-text-base aria-[current=page]:[&_svg]:text-icon-base`}
                >
                  <Icon icon={section.icon} />
                  {t(section.label)}
                </Link>
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="px-2 text-[13px]/7 text-text-faint">{t("settings.nothing")}</p>}
        </nav>
      </div>
    </div>
  );
}
