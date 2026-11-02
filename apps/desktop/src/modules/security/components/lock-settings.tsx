import { useTranslation } from "react-i18next";
import { Segmented } from "@/core/ui/segmented";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { setLockMinutes, useLockSettings, useLockToggle } from "../interactions/lock";
import { LOCK_MINUTES, systemOf } from "../model/lock";

// Раздел «Безопасность»: блокировка окна после бездействия. Чем открывать
// окно, зависит от системы, поэтому и текст свой у каждой.
export function LockSettings() {
  const { t } = useTranslation();
  const settings = useLockSettings();
  const { toggle, checking, failure } = useLockToggle();
  const system = systemOf(navigator.userAgent);
  let description: string = t(`security.lock.enabled.${system}`);

  if (checking) {
    description = t("security.lock.checking");
  } else if (failure === "failed") {
    description = t("security.lock.failed");
  } else if (failure === "unavailable") {
    description = t(`security.lock.unavailable.${system}`);
  }

  return (
    <SettingsSection title={t("security.title")} description={t("security.description")}>
      <SettingsGroup>
        <SettingsRow title={t("security.lock.enabled.title")} description={description}>
          <input
            type="checkbox"
            aria-label={t("security.lock.enabled.title")}
            className="accent-bg-accent"
            checked={settings.enabled}
            disabled={checking}
            onChange={(event) => toggle(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow title={t("security.lock.minutes.title")} description={t("security.lock.minutes.description")}>
          <Segmented
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
