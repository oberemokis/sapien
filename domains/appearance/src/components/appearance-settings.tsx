import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup, SettingsRow, SettingsSection, SettingsSelect } from "@sapien/ui";
import { setLanguage, useLanguage } from "../interactions/language";
import { setUiScale, useUiScale } from "../interactions/scale";
import { setThemePreference, useThemePreference } from "../interactions/theme";
import { LANGUAGES } from "../model/language";
import { UI_SCALES } from "../model/scale";
import { THEME_PREFERENCES, type Theme, type ThemePreference } from "../model/theme";

// Цвета превью берутся из шкал, а не из смысловых токенов: превью
// показывает тему, а не ту, что включена сейчас.
const PALETTES = {
  dark: { frame: "var(--grey-1100)", panel: "var(--grey-1000)", line: "var(--grey-800)" },
  light: { frame: "var(--grey-200)", panel: "var(--grey-50)", line: "var(--grey-400)" },
} satisfies Record<Theme, Record<string, string>>;

// Окно в миниатюре: слева список, справа содержимое.
function Preview({ theme }: { theme: Theme }) {
  const { frame, panel, line } = PALETTES[theme];

  return (
    <div className="flex size-full gap-2 p-2" style={{ background: frame }}>
      <div className="flex w-1/4 flex-col gap-2 pt-1.5 pl-1">
        {[80, 55, 70, 45, 60].map((width) => (
          <span key={width} className="h-1 rounded-full" style={{ width: `${width}%`, background: line }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 rounded-sm p-2.5" style={{ background: panel }}>
        {[85, 70, 78, 55].map((width) => (
          <span key={width} className="h-1 rounded-full" style={{ width: `${width}%`, background: line }} />
        ))}
        <span className="mt-auto h-3.5 rounded-sm" style={{ background: frame }} />
      </div>
    </div>
  );
}

// «Как в системе» показывает обе темы: светлую слева, тёмную справа.
function ThemePreview({ preference }: { preference: ThemePreference }) {
  if (preference !== "system") {
    return <Preview theme={preference} />;
  }

  return (
    <div className="relative size-full">
      <Preview theme="light" />
      <div className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
        <Preview theme="dark" />
      </div>
    </div>
  );
}

// Тема карточками с превью, как выбор раскладки в opencode. Под видом
// обычные радиокнопки: стрелки, фокус и чтение с экрана браузер даёт сам.
function ThemePicker() {
  const { t } = useTranslation("appearance");
  const preference = useThemePreference();
  const id = useId();

  return (
    <section className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="text-[13px]/4 font-medium">
        {t("theme.title")}
      </h2>
      <fieldset aria-labelledby={`${id}-title`} className="grid grid-cols-3 gap-2.5">
        {THEME_PREFERENCES.map((value) => (
          <label
            key={value}
            className="flex cursor-default flex-col gap-3 rounded-lg bg-bg-layer-01 p-2.5 shadow-[inset_0_0_0_0.5px_var(--border-border-muted)] transition-shadow duration-120 has-checked:shadow-[inset_0_0_0_1px_var(--color-bg-accent)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-border-focus"
          >
            <div aria-hidden className="h-24 overflow-hidden rounded-md shadow-[0_0_0_0.5px_var(--border-border-muted)]">
              <ThemePreview preference={value} />
            </div>
            <div className="flex gap-2.5 px-1 pb-1">
              <input
                type="radio"
                name={id}
                value={value}
                checked={value === preference}
                aria-labelledby={`${id}-${value}`}
                aria-describedby={`${id}-${value}-hint`}
                className="mt-0.5 size-3.5 shrink-0 appearance-none rounded-full shadow-[inset_0_0_0_1px_var(--border-border-strong)] outline-none transition-shadow duration-120 checked:shadow-[inset_0_0_0_4px_var(--color-bg-accent)]"
                onChange={() => setThemePreference(value)}
              />
              <span className="flex flex-col gap-1">
                <span id={`${id}-${value}`} className="text-[13px]/5 font-medium">
                  {t(`theme.${value}`)}
                </span>
                <span id={`${id}-${value}-hint`} className="text-[13px]/5 text-text-muted">
                  {t(`theme.${value}Hint`)}
                </span>
              </span>
            </div>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

// Раздел «Внешний вид». Выбор применяется сразу, кнопки «Сохранить» нет.
export function AppearanceSettings() {
  const { t } = useTranslation("appearance");
  const scale = useUiScale();
  const language = useLanguage();

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <ThemePicker />
      <SettingsGroup>
        <SettingsRow title={t("language.title")} description={t("language.description")}>
          <SettingsSelect
            label={t("language.title")}
            value={language}
            options={LANGUAGES}
            onChange={setLanguage}
          />
        </SettingsRow>
        <SettingsRow title={t("scale.title")} description={t("scale.description")}>
          <SettingsSelect
            label={t("scale.title")}
            value={String(scale)}
            options={UI_SCALES.map((value) => ({ value: String(value), label: `${value}%` }))}
            onChange={(value) => setUiScale(UI_SCALES.find((candidate) => String(candidate) === value) ?? scale)}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
