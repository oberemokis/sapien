import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  offer: {
    label: "Обновление приложения",
    title: "Доступна версия {{version}}",
    current: "Сейчас установлена {{version}}.",
    release: "Страница релиза",
    later: "Позже",
    install: "Обновить и перезапустить",
    downloading: "Загружаю обновление…",
    downloaded: "Загружено {{percent}}%",
    installing: "Ставлю обновление…",
  },
  problems: {
    update_signature:
      "Подпись обновления не сошлась с ключом приложения, поэтому оно не поставлено. Установленная версия работает как прежде.",
    update_unreachable: "Нет связи с GitHub. Установленная версия работает как прежде.",
    update_failed: "Обновление не поставилось. Установленная версия работает как прежде.",
  },
} as const;

const en: Dictionary<typeof ru> = {
  offer: {
    label: "App update",
    title: "Version {{version}} is available",
    current: "Installed: {{version}}.",
    release: "Release page",
    later: "Later",
    install: "Update and restart",
    downloading: "Downloading the update…",
    downloaded: "Downloaded {{percent}}%",
    installing: "Installing the update…",
  },
  problems: {
    update_signature:
      "The update signature did not match the app key, so it was not installed. The installed version keeps working.",
    update_unreachable: "Cannot reach GitHub. The installed version keeps working.",
    update_failed: "The update was not installed. The installed version keeps working.",
  },
};

declare module "@sapien/i18n" {
  interface Resources {
    updates: typeof ru;
  }
}

export const dictionary = { ru, en };
