import { useTranslation } from "react-i18next";
import { SettingsGroup, SettingsRow, SettingsSection, SettingsSelect, SWITCH } from "@sapien/ui";
import { setLockMinutes, useLockSettings, useLockToggle } from "../interactions/lock";
import { LOCK_MINUTES } from "../model/lock";

// Раздел «Безопасность»: блокировка окна после бездействия.
export function LockSettings() {
  const { t } = useTranslation("security");
  const settings = useLockSettings();
  const { toggle, checking, failure } = useLockToggle();
  let description: string = t("lock.enabled.description");

  if (checking) {
    description = t("lock.checking");
  } else if (failure === "failed") {
    description = t("lock.failed");
  } else if (failure === "unavailable") {
    description = t("lock.unavailable");
  }

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingsGroup>
        <SettingsRow title={t("lock.enabled.title")} description={description}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={settings.enabled}
            aria-label={t("lock.enabled.title")}
            className={SWITCH}
            checked={settings.enabled}
            disabled={checking}
            onChange={(event) => toggle(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title={t("lock.minutes.title")} description={t("lock.minutes.description")}>
          <SettingsSelect
            label={t("lock.minutes.title")}
            value={String(settings.minutes)}
            options={LOCK_MINUTES.map((minutes) => ({
              value: String(minutes),
              label: t(`lock.minutes.m${minutes}`),
            }))}
            onChange={(value) =>
              setLockMinutes(LOCK_MINUTES.find((minutes) => String(minutes) === value) ?? settings.minutes)
            }
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
