import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  title: "Безопасность",
  description:
    "Пока вы отошли, окно закрыто заглушкой, и его не видно ни в превью окон, ни в переключателе приложений.",
  lock: {
    enabled: {
      title: "Блокировать окно",
      description: "После бездействия окно закрывается и открывается по Touch ID или паролю Mac.",
    },
    checking: "Подтвердите в окне системы…",
    failed: "Проверка не прошла, блокировка не включена.",
    unavailable: "Системе нечем спросить: у учётной записи Mac нет пароля. Блокировка не включена.",
    minutes: {
      title: "Через",
      description: "Сколько окно ждёт без мыши и клавиатуры.",
      m1: "1 мин",
      m5: "5 мин",
      m15: "15 мин",
      m30: "30 мин",
      m60: "1 ч",
    },
    screen: {
      title: "sapien заблокирован",
      unlock: "Разблокировать",
      failed: "Проверка не прошла. Попробуйте ещё раз.",
    },
  },
} as const;

const en: Dictionary<typeof ru> = {
  title: "Security",
  description:
    "While you are away, the window is covered and hidden from window previews and the app switcher.",
  lock: {
    enabled: {
      title: "Lock window",
      description: "After inactivity the window locks and opens with Touch ID or your Mac password.",
    },
    checking: "Confirm in the system dialog…",
    failed: "The check did not pass, locking is not enabled.",
    unavailable: "The system has nothing to ask with: your Mac account has no password. Locking is not enabled.",
    minutes: {
      title: "After",
      description: "How long the window waits without mouse or keyboard.",
      m1: "1 min",
      m5: "5 min",
      m15: "15 min",
      m30: "30 min",
      m60: "1 h",
    },
    screen: {
      title: "sapien is locked",
      unlock: "Unlock",
      failed: "The check did not pass. Please try again.",
    },
  },
};

declare module "@sapien/i18n" {
  interface Resources {
    security: typeof ru;
  }
}

export const dictionary = { ru, en };
