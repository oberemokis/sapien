import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { changeTemplateSettings, useTemplateSettings } from "../interactions/templates";
import { useChooseVault, useVaultStatus } from "../interactions/vault";
import { formatDate, type TemplateSettings } from "../model/templates";

// Поле настройки. Пустое значение не сохраняется: стёр, чтобы набрать
// новое, и прежнее действует, пока новое не набрано. Ушёл из пустого поля,
// и в нём снова прежнее.
function TextSetting({ name, label }: { name: keyof TemplateSettings; label: string }) {
  const settings = useTemplateSettings();
  const [draft, setDraft] = useState(settings[name]);

  return (
    <input
      aria-label={label}
      value={draft}
      spellCheck={false}
      className="h-8 w-48 rounded-md border border-stroke bg-transparent px-2 text-[13px] outline-none focus:border-accent"
      onChange={(event) => {
        setDraft(event.target.value);

        if (event.target.value.trim() !== "") {
          changeTemplateSettings({ [name]: event.target.value });
        }
      }}
      onBlur={() => setDraft(settings[name])}
    />
  );
}

// Раздел «Хранилище»: какая папка открыта, выбор другой и шаблоны.
export function VaultSettings() {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const choose = useChooseVault();
  const templates = useTemplateSettings();
  const data = status.data;
  const path = data === undefined || data.kind === "none" ? t("vault.settings.notChosen") : data.path;
  // Пример формата на момент открытия настроек.
  const [now] = useState(() => new Date());

  return (
    <SettingsSection title={t("vault.settings.title")} description={t("vault.settings.description")}>
      <SettingsGroup>
        <SettingsRow title={t("vault.settings.folder")} description={path}>
          <Button disabled={choose.isPending} onClick={() => choose.mutate()}>
            {t("vault.settings.change")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      {/* Подстановки в описании показаны как есть, поэтому идут значениями. */}
      <SettingsGroup
        title={t("vault.settings.templates")}
        description={t("vault.settings.templatesDescription", {
          title: "{{title}}",
          date: "{{date}}",
          time: "{{time}}",
        })}
      >
        <SettingsRow title={t("vault.settings.templateFolder")} description={t("vault.settings.templateFolderHint")}>
          <TextSetting name="folder" label={t("vault.settings.templateFolder")} />
        </SettingsRow>
        <SettingsRow
          title={t("vault.settings.dateFormat")}
          description={t("vault.settings.formatHint", { now: formatDate(now, templates.dateFormat) })}
        >
          <TextSetting name="dateFormat" label={t("vault.settings.dateFormat")} />
        </SettingsRow>
        <SettingsRow
          title={t("vault.settings.timeFormat")}
          description={t("vault.settings.formatHint", { now: formatDate(now, templates.timeFormat) })}
        >
          <TextSetting name="timeFormat" label={t("vault.settings.timeFormat")} />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
