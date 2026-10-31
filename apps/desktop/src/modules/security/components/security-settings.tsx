import { useTranslation } from "react-i18next";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useSecurityStatus } from "../interactions/security";
import { diskState } from "../model/security";

const BADGE = "rounded-md border border-stroke px-2 py-1 text-[13px]";

// Раздел «Безопасность»: что закрывает данные, если ноутбук украли или
// скопировали диск. Данные приложения шифрует оно само, заметки только
// шифрование диска системы: их должны открывать Obsidian и другие редакторы.
export function SecuritySettings() {
  const { t } = useTranslation();
  const status = useSecurityStatus();

  if (status === undefined) {
    return (
      <SettingsSection title={t("security.title")} description={t("security.description")}>
        <p className="text-sm text-content/50">{t("security.checking")}</p>
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
          <span className={status.data === "sealed" ? BADGE : `${BADGE} text-diff-del-fg`}>
            {t(`security.data.badge.${status.data}`)}
          </span>
        </SettingsRow>
        <SettingsRow title={t("security.disk.title")} description={diskText}>
          <span className={disk === "on" ? BADGE : `${BADGE} text-diff-del-fg`}>{t(`security.disk.badge.${disk}`)}</span>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
