import { useTranslation } from "react-i18next";
import { SettingsGroup, SettingsRow, SettingsSection, SettingsSelect, SWITCH } from "@sapien/ui";
import { setLockMinutes, useLockSettings, useLockToggle } from "../interactions/lock";
import { LOCK_MINUTES } from "../model/lock";

// Раздел «Безопасность»: блокировка окна после бездействия.
export function LockSettings() {
  const { t } = useTranslation();
  const settings = useLockSettings();
  const { toggle, checking, failure } = useLockToggle();
  let description: string = t("security.lock.enabled.description");

  if (checking) {
    description = t("security.lock.checking");
  } else if (failure === "failed") {
    description = t("security.lock.failed");
  } else if (failure === "unavailable") {
    description = t("security.lock.unavailable");
  }

  return (
    <SettingsSection title={t("security.title")} description={t("security.description")}>
      <SettingsGroup>
        <SettingsRow title={t("security.lock.enabled.title")} description={description}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={settings.enabled}
            aria-label={t("security.lock.enabled.title")}
            className={SWITCH}
            checked={settings.enabled}
            disabled={checking}
            onChange={(event) => toggle(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title={t("security.lock.minutes.title")} description={t("security.lock.minutes.description")}>
          <SettingsSelect
            label={t("security.lock.minutes.title")}
            value={String(settings.minutes)}
            options={LOCK_MINUTES.map((minutes) => ({
              value: String(minutes),
              label: t(`security.lock.minutes.m${minutes}`),
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
