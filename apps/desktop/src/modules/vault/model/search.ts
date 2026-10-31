import { noteTitle, parentOf, type VaultEntry } from "./vault";

export type NoteItem = { path: string; title: string; folder: string };

export type Found = NoteItem & { hits: number[] };

// Сколько строк показывает окно поиска и сколько недавних помнится.
export const SEARCH_LIMIT = 50;
export const RECENT_LIMIT = 20;

// Все заметки дерева одним списком.
export function notesOf(tree: VaultEntry[]): NoteItem[] {
  return tree.flatMap((entry) => {
    if (entry.kind === "folder") {
      return notesOf(entry.children);
    }

    return [{ path: entry.path, title: noteTitle(entry.name), folder: parentOf(entry.path) }];
  });
}

// По букве на букву, чтобы номера совпавших букв указывали в исходное имя.
// Регистр и «ё» на совпадение не влияют.
function fold(text: string) {
  return Array.from({ length: text.length }, (_, index) => {
    const lower = text[index]?.toLowerCase().replace("ё", "е") ?? "";

    return lower.charAt(0) || " ";
  }).join("");
}

function startsWord(text: string, index: number) {
  return index === 0 || /[\s\-_.(]/.test(text[index - 1] ?? "");
}

// Нечёткое совпадение: буквы запроса идут в имени по порядку, «прзнт»
// находит «Презентация». Подряд идущие буквы и начала слов весят больше,
// целое вхождение больше всего.
export function fuzzyMatch(query: string, text: string): { score: number; hits: number[] } | null {
  const needle = fold(query.trim());
  const haystack = fold(text);

  if (needle === "") {
    return { score: 0, hits: [] };
  }

  const at = haystack.indexOf(needle);

  if (at !== -1) {
    const hits = Array.from({ length: needle.length }, (_, index) => at + index);
    let score = 1000 - at;

    if (startsWord(haystack, at)) {
      score += 500;
    }

    return { score, hits };
  }

  const hits: number[] = [];
  let from = 0;

  for (const letter of needle) {
    const index = haystack.indexOf(letter, from);

    if (index === -1) {
      return null;
    }

    hits.push(index);
    from = index + 1;
  }

  let score = 0;

  hits.forEach((hit, index) => {
    if (hits[index - 1] === hit - 1) {
      score += 10;
    }

    if (startsWord(haystack, hit)) {
      score += 8;
    }
  });

  return { score: score - (hits.at(-1) ?? 0) + (hits[0] ?? 0), hits };
}

// Лучшие совпадения сверху, при равенстве короткое имя, потом путь.
export function searchNotes(notes: NoteItem[], query: string): Found[] {
  const found = notes.flatMap((note) => {
    const match = fuzzyMatch(query, note.title);

    if (match === null) {
      return [];
    }

    return [{ ...note, ...match }];
  });

  found.sort(
    (a, b) => b.score - a.score || a.title.length - b.title.length || a.path.localeCompare(b.path, "ru"),
  );

  return found.slice(0, SEARCH_LIMIT).map(({ score: _score, ...note }) => note);
}

// Недавние открытые, свежие первыми. Пропавшие с диска не показываются.
export function recentNotes(notes: NoteItem[], recent: string[]): Found[] {
  const byPath = new Map(notes.map((note) => [note.path, note]));

  return recent.flatMap((path) => {
    const note = byPath.get(path);

    if (note === undefined) {
      return [];
    }

    return [{ ...note, hits: [] }];
  });
}

export function pushRecent(recent: string[], path: string) {
  return [path, ...recent.filter((item) => item !== path)].slice(0, RECENT_LIMIT);
}

// Список из хранилища окна: что угодно, кроме массива строк, это пустой список.
export function parseRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === "string").slice(0, RECENT_LIMIT);
}

// Имя на куски для подсветки: совпавшие буквы отдельно от остальных.
// Начало куска в имени служит ему ключом.
export function highlight(text: string, hits: number[]) {
  const marked = new Set(hits);
  const parts: { text: string; hit: boolean; start: number }[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const hit = marked.has(index);
    const last = parts.at(-1);

    if (last?.hit === hit) {
      last.text += text[index];
    } else {
      parts.push({ text: text[index] ?? "", hit, start: index });
    }
  }

  return parts;
}
