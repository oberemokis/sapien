// Новая версия из последнего релиза GitHub. notes это описание релиза
// в markdown: что изменилось с прошлой версии.
export type Update = {
  version: string;
  notes: string | null;
};

// Ход загрузки из канала Rust. total нет, когда сервер не назвал размер.
export type UpdateProgress = { kind: "chunk"; received: number; total: number | null } | { kind: "downloaded" };

const PROBLEMS = ["update_signature", "update_unreachable"] as const;

export type UpdateProblem = (typeof PROBLEMS)[number] | "update_failed";

// Код из отказа команды, AppError из error.rs. Остальное, вроде отказа
// диска при установке, окно показывает общей причиной.
export function updateProblemOf(error: unknown): UpdateProblem {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    const known = PROBLEMS.find((problem) => problem === code);

    if (known !== undefined) {
      return known;
    }
  }

  return "update_failed";
}

// Сколько скачано, в процентах. Пока размер неизвестен, процентов нет.
export function percentOf(progress: UpdateProgress | null): number | null {
  if (progress?.kind !== "chunk" || progress.total === null || progress.total === 0) {
    return null;
  }

  return Math.min(100, Math.round((progress.received / progress.total) * 100));
}

// Пункты описания релиза для окна. Описание собирает GitHub по
// пул-реквестам: «* feat(agent): действия by @автор in <адрес>». Тип
// коммита, автор и адрес человеку ничего не говорят, а новые участники
// и полный список изменений не про приложение. Повтор пункта не нужен.
export function releaseItems(notes: string | null) {
  const items = new Set<string>();

  for (const line of (notes ?? "").split("\n")) {
    const text = line
      .trim()
      .replace(/^[*-]\s+/, "")
      .replace(/\s+by @[\w-]+ in https:\/\/\S+$/, "")
      .replace(/^\w+(\([^)]*\))?!?:\s+/, "");
    const skipped =
      text === "" || text.startsWith("#") || text.startsWith("**Full Changelog**") || text.includes("made their first contribution");

    if (!skipped) {
      items.add(text.charAt(0).toUpperCase() + text.slice(1));
    }
  }

  return [...items];
}

// Страница релиза версии: на ней описание и файлы для ручной установки.
export function releaseUrl(version: string) {
  return `https://github.com/oberemokis/sapien/releases/tag/v${version}`;
}
