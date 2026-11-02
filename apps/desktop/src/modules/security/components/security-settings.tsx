import { useTranslation } from "react-i18next";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useSecurityStatus } from "../interactions/security";
import { diskState } from "../model/security";
import { LockSettings } from "./lock-settings";

// Метка состояния, как Tag дизайн-системы. Красная, когда защиты нет.
const BADGE = "inline-flex h-5 items-center rounded-xs bg-bg-layer-03 px-1.5 text-[11px] font-medium text-text-muted";
const DANGER = "inline-flex h-5 items-center rounded-xs bg-state-bg-danger px-1.5 text-[11px] font-medium text-state-fg-danger";

// Раздел «Безопасность»: что закрывает данные, если ноутбук украли или
// скопировали диск. Данные приложения шифрует оно само, заметки только
// шифрование диска системы: их должны открывать Obsidian и другие редакторы.
export function SecuritySettings() {
  const { t } = useTranslation();
  const status = useSecurityStatus();

  if (status === undefined) {
    return (
      <SettingsSection title={t("security.title")} description={t("security.description")}>
        <p className="text-[13px] text-text-muted">{t("security.checking")}</p>
      </SettingsSection>
    );
  }

  const disk = diskState(status.disk);
  let diskText: string = t("security.disk.unknown");

  if (disk === "on") {
    diskText = t(`security.disk.on.${status.system}`);
  } else if (disk === "off") {
    diskText = t(`security.disk.off.${status.system}`);
  }

  return (
    <SettingsSection title={t("security.title")} description={t("security.description")}>
      <SettingsGroup>
        <SettingsRow title={t("security.data.title")} description={t(`security.data.${status.data}`)}>
          <span className={status.data === "sealed" ? BADGE : DANGER}>
            {t(`security.data.badge.${status.data}`)}
          </span>
        </SettingsRow>
        <SettingsRow title={t("security.disk.title")} description={diskText}>
          <span className={disk === "on" ? BADGE : DANGER}>{t(`security.disk.badge.${disk}`)}</span>
        </SettingsRow>
      </SettingsGroup>
      <LockSettings system={status.system} />
    </SettingsSection>
  );
}
