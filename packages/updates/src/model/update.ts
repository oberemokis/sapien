import type { Progress, UpdateCode } from "@sapien/ipc";

// Подсказка на каждый код отказа обновления, как у forge: новый код Rust
// не скомпилируется без решения окна.
const PROBLEMS = {
  update_signature: "update_signature",
  update_unreachable: "update_unreachable",
  update_missing: "update_failed",
  update_failed: "update_failed",
} as const satisfies Record<UpdateCode, string>;

export type UpdateProblem = (typeof PROBLEMS)[UpdateCode];

// Код из отказа команды. Остальное, вроде отказа диска при установке,
// окно показывает общей причиной.
export function updateProblemOf(error: unknown): UpdateProblem {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  return Object.entries(PROBLEMS).find(([known]) => known === code)?.[1] ?? "update_failed";
}

// Сколько скачано, в процентах. Пока размер неизвестен, процентов нет.
export function percentOf(progress: Progress | null): number | null {
  if (progress?.kind !== "chunk" || !progress.total) {
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
