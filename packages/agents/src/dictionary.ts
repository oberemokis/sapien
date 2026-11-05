import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  title: "Агент",
  description: "Агент работает подпиской Claude через Claude Code на этом устройстве.",
  claude: {
    description:
      "Claude Code со входом по подписке. Сообщения и файлы, которые прочитает агент, уходят в Anthropic через него, а разговор хранит сам Claude Code.",
    checking: "Проверяю Claude Code…",
    failed: "Не удалось проверить Claude Code.",
    check: "Проверить снова",
    version: "Версия {{version}}.",
    ready: "Вход по подписке Claude.",
    missing: "Не найден. Поставьте его командой curl -fsSL https://claude.ai/install.sh | bash и войдите.",
    outdated: "Нужна версия 2.1.299 или новее: обновите командой claude update.",
    logged_out: "Вход не выполнен: запустите claude в терминале и войдите через /login по подписке Claude.",
    not_subscription: "Вход выполнен не по подписке: войдите через /login аккаунтом claude.ai.",
  },
  integrations: {
    title: "Продолжение разговоров",
    description:
      "Интеграция сообщает sapien, какой разговор агента идёт в панели, и после перезапуска приложения агент продолжает его. Она дописывает хук в настройки агента или кладёт туда своё расширение.",
    missing: "Не найден на этом устройстве.",
    off: "Не подключена.",
    on: "Подключена: после перезапуска разговоры продолжатся.",
    codexTrust: "Codex спросит, доверять ли хуку: разрешите его в /hooks.",
    install: "Подключить",
    remove: "Отключить",
    failed: "Не удалось поменять настройки агента.",
    loadFailed: "Не удалось прочитать настройки агентов.",
  },
} as const;

const en: Dictionary<typeof ru> = {
  title: "Agent",
  description: "The agent uses your Claude subscription through Claude Code on this device.",
  claude: {
    description:
      "Claude Code signed in with a subscription. Messages and the files the agent reads go to Anthropic through it, and Claude Code keeps the conversation itself.",
    checking: "Checking Claude Code…",
    failed: "Could not check Claude Code.",
    check: "Check again",
    version: "Version {{version}}.",
    ready: "Signed in with a Claude subscription.",
    missing: "Not found. Install it with curl -fsSL https://claude.ai/install.sh | bash and sign in.",
    outdated: "Version 2.1.299 or newer is required: update with claude update.",
    logged_out: "Not signed in: run claude in a terminal and sign in with /login using your Claude subscription.",
    not_subscription: "Signed in without a subscription: sign in with /login using a claude.ai account.",
  },
  integrations: {
    title: "Resuming conversations",
    description:
      "The integration tells sapien which agent conversation runs in a pane, and after the app restarts the agent resumes it. It adds a hook to the agent's settings or places its own extension there.",
    missing: "Not found on this device.",
    off: "Not connected.",
    on: "Connected: conversations resume after a restart.",
    codexTrust: "Codex asks whether to trust the hook: allow it in /hooks.",
    install: "Connect",
    remove: "Disconnect",
    failed: "Could not change the agent's settings.",
    loadFailed: "Could not read the agents' settings.",
  },
};

declare module "@sapien/i18n" {
  interface Resources {
    agents: typeof ru;
  }
}

export const dictionary = { ru, en };
