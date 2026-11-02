import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
import Plug01Icon from "@hugeicons/core-free-icons/Plug01Icon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";

// Разделы по группам, порядок как на экране. Раздел появляется вместе со
// своей задачей: страница в pages/settings.<раздел>.tsx и строка здесь.
export const SETTINGS_GROUPS = [
  {
    label: "settings.groups.app",
    sections: [
      { to: "/settings/appearance", label: "appearance.title", icon: PaintBoardIcon },
      { to: "/settings/agent", label: "agent.settings.title", icon: AiChat02Icon },
      { to: "/settings/integrations", label: "forge.title", icon: Plug01Icon },
      { to: "/settings/security", label: "security.title", icon: SecurityLockIcon },
    ],
  },
] as const;
