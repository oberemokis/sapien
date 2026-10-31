import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";

// Разделы по группам, порядок как на экране. Раздел появляется вместе со
// своей задачей: страница в pages/settings.<раздел>.tsx и строка здесь.
export const SETTINGS_GROUPS = [
  {
    label: "settings.groups.app",
    sections: [
      { to: "/settings/appearance", label: "appearance.title", icon: PaintBoardIcon },
      { to: "/settings/vault", label: "vault.settings.title", icon: Folder01Icon },
    ],
  },
] as const;
