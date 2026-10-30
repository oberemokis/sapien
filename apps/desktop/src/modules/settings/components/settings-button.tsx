import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/core/ui/icon-button";
import { shortcutLabel } from "@/core/ui/keys";
import { useOpenSettings } from "./navigation";

export function SettingsButton() {
  const { t } = useTranslation();

  return (
    <IconButton
      icon={Settings01Icon}
      label={t("settings.open")}
      shortcut={shortcutLabel(",")}
      onClick={useOpenSettings()}
    />
  );
}
