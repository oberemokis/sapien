import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useAppVersion, useUpdateCheck } from "../interactions/update";
import { releaseUrl } from "../model/update";

// Что сказала последняя проверка. Здесь видна и ошибка, которую
// проверка по расписанию не показывает.
function useCheckStatus() {
  const { t } = useTranslation();
  const { update, checking, problem, online } = useUpdateCheck();

  if (!online) {
    return t("updates.status.offline");
  }

  if (checking) {
    return t("updates.status.checking");
  }

  if (problem !== null) {
    return t(`updates.problems.${problem}`);
  }

  if (update === null) {
    return t("updates.status.latest");
  }

  if (update !== undefined) {
    return t("updates.status.available", { version: update.version });
  }

  return t("updates.status.idle");
}

// Раздел «О приложении», как About в MonoCode: версия, что в ней нового
// и проверка обновлений по кнопке. Найденное обновление предлагает
// карточка в углу окна, та же, что после проверки по расписанию.
export function AboutSettings() {
  const { t } = useTranslation();
  const version = useAppVersion();
  const { checking, online, recheck } = useUpdateCheck();
  const status = useCheckStatus();

  return (
    <SettingsSection title={t("updates.title")} description={t("updates.description")}>
      <SettingsGroup>
        <SettingsRow
          title={
            <>
              {t("updates.version")}
              <span className="ml-2 font-mono text-content/50">{version}</span>
            </>
          }
          description={status}
        >
          <div className="flex gap-2">
            <Button
              disabled={version === undefined}
              onClick={() => {
                if (version !== undefined) {
                  openLink(releaseUrl(version));
                }
              }}
            >
              {t("updates.whats_new")}
            </Button>
            <Button disabled={!online || checking} onClick={recheck}>
              <span className="inline-flex items-center gap-1.5">
                <Icon icon={Refresh01Icon} size={14} />
                {t("updates.check")}
              </span>
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
