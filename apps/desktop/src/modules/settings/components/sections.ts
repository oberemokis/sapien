import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
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
      { to: "/settings/vault", label: "vault.settings.title", icon: Folder01Icon },
      { to: "/settings/agent", label: "agent.settings.title", icon: AiChat02Icon },
      { to: "/settings/actions", label: "agent.actions.title", icon: FlashIcon },
      { to: "/settings/integrations", label: "youtrack.settings.title", icon: Plug01Icon },
      { to: "/settings/security", label: "security.title", icon: SecurityLockIcon },
      { to: "/settings/about", label: "updates.title", icon: InformationCircleIcon },
    ],
  },
] as const;
