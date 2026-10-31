import { useTranslation } from "react-i18next";
import { Segmented } from "@/core/ui/segmented";
import { SettingsGroup, SettingsRow } from "@/core/ui/settings";
import { setLockMinutes, useLockSettings, useLockToggle } from "../interactions/lock";
import { LOCK_MINUTES } from "../model/lock";
import type { System } from "../model/security";

// Блокировка окна в разделе «Безопасность». Чем открывать окно, зависит
// от системы, поэтому и текст свой у каждой.
export function LockSettings({ system }: { system: System }) {
  const { t } = useTranslation();
  const settings = useLockSettings();
  const { toggle, checking, failure } = useLockToggle();
  let description: string = t(`security.lock.enabled.${system}`);

  if (checking) {
    description = t("security.lock.checking");
  } else if (failure === "failed") {
    description = t("security.lock.failed");
  } else if (failure === "unavailable") {
    description = t(`security.lock.unavailable.${system}`);
  }

  return (
    <SettingsGroup title={t("security.lock.title")} description={t("security.lock.description")}>
      <SettingsRow title={t("security.lock.enabled.title")} description={description}>
        <input
          type="checkbox"
          aria-label={t("security.lock.enabled.title")}
          className="accent-accent"
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
          onChange={(value) => setLockMinutes(LOCK_MINUTES.find((minutes) => String(minutes) === value) ?? settings.minutes)}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
