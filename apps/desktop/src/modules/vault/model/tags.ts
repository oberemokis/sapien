// Теги одной заметки как написаны, без решётки.
export type NoteTags = { path: string; tags: string[] };

export type TagCount = { name: string; count: number };

// «#Работа» и «#работа» это один тег.
function tagKey(tag: string) {
  return tag.toLowerCase();
}

// Тег вместе с родителями: «работа/sapien» это ещё и «работа».
function withParents(tag: string) {
  const parts = tag.split("/");

  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Все теги хранилища по алфавиту с числом заметок. Родитель вложенного
// тега тоже в списке и считает заметки вложенных. Пишется тег так, как
// встретился первым по пути заметки.
export function tagList(notes: NoteTags[]): TagCount[] {
  const names = new Map<string, string>();
  const paths = new Map<string, Set<string>>();

  for (const note of notes.toSorted((a, b) => a.path.localeCompare(b.path, "ru"))) {
    for (const tag of note.tags.flatMap(withParents)) {
      const key = tagKey(tag);

      if (!names.has(key)) {
        names.set(key, tag);
        paths.set(key, new Set());
      }

      paths.get(key)?.add(note.path);
    }
  }

  return [...names]
    .map(([key, name]) => ({ name, count: paths.get(key)?.size ?? 0 }))
    .toSorted((a, b) => a.name.localeCompare(b.name, "ru"));
}

// Заметки, где есть все теги из списка, вложенные тоже: «работа» находит
// и «работа/sapien».
export function notesWithTags(notes: NoteTags[], wanted: string[]): Set<string> {
  const keys = wanted.map(tagKey);

  return new Set(
    notes
      .filter((note) => {
        const have = new Set(note.tags.flatMap(withParents).map(tagKey));

        return keys.every((key) => have.has(key));
      })
      .map((note) => note.path),
  );
}

// Запрос поиска на теги и имя: «#работа план» это тег «работа» и имя «план».
// Одинокая решётка ещё не тег и не имя.
export function splitQuery(query: string) {
  const words = query.trim().split(/\s+/).filter((word) => word !== "" && word !== "#");

  return {
    tags: words.filter((word) => word.startsWith("#")).map((word) => word.slice(1)),
    name: words.filter((word) => !word.startsWith("#")).join(" "),
  };
}
