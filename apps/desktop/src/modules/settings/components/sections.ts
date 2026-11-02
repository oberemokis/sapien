import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
import Plug01Icon from "@hugeicons/core-free-icons/Plug01Icon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";

// Разделы по группам, порядок как на экране: сначала агент и то, с чем он
// работает, потом само приложение. Раздел появляется вместе со своей
// задачей: страница в pages/settings.<раздел>.tsx и строка здесь. По terms
// раздел находит поиск: пояснение и строки раздела.
export const SETTINGS_GROUPS = [
  [
    {
      to: "/settings/agent",
      label: "agent.settings.title",
      icon: AiChat02Icon,
      terms: ["agent.settings.description", "agent.settings.model"],
    },
    {
      to: "/settings/integrations",
      label: "forge.title",
      icon: Plug01Icon,
      terms: ["forge.description"],
    },
  ],
  [
    {
      to: "/settings/appearance",
      label: "appearance.title",
      icon: PaintBoardIcon,
      terms: ["appearance.description", "appearance.theme.title"],
    },
    {
      to: "/settings/security",
      label: "security.title",
      icon: SecurityLockIcon,
      terms: ["security.description", "security.lock.enabled.title", "security.lock.minutes.title"],
    },
  ],
] as const;
