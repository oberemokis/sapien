import { useTranslation } from "react-i18next";
import { IconButton } from "@/core/ui/icon-button";
import { shortcutLabel } from "@/core/ui/keys";
import { useOpenSettings } from "./navigation";

export function SettingsButton() {
  const { t } = useTranslation();

  return (
    <IconButton
      icon="settings-gear"
      label={t("settings.open")}
      shortcut={shortcutLabel(",")}
      onClick={useOpenSettings()}
    />
  );
}
