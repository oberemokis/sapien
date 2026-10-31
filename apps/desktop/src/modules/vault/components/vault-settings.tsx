import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useChooseVault, useVaultStatus } from "../interactions/vault";

// Раздел «Хранилище»: какая папка открыта, и выбор другой.
export function VaultSettings() {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const choose = useChooseVault();
  const data = status.data;
  const path = data === undefined || data.kind === "none" ? t("vault.settings.notChosen") : data.path;

  return (
    <SettingsSection title={t("vault.settings.title")} description={t("vault.settings.description")}>
      <SettingsGroup>
        <SettingsRow title={t("vault.settings.folder")} description={path}>
          <Button disabled={choose.isPending} onClick={() => choose.mutate()}>
            {t("vault.settings.change")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
