// Ответы команд Rust из src-tauri/src/modules/vault. Формы держатся руками:
// поменял там, поменяй здесь.
export type VaultStatus =
  | { kind: "none" }
  | { kind: "missing"; path: string }
  | { kind: "ready"; path: string };

export type VaultEntry =
  | { kind: "folder"; name: string; path: string; children: VaultEntry[] }
  | { kind: "note"; name: string; path: string };

export type EntryKind = VaultEntry["kind"];

// Что середина окна отдаёт редактору открытой заметки. Сам редактор
// ставит страница.
export type EditorProps = {
  value: string;
  onChange: (text: string) => void;
  // Файл пропал с диска: текст виден, но не правится.
  readOnly: boolean;
  // Номер просьбы поставить курсор в текст, 0 если просьбы нет. Каждый
  // новый номер ставит курсор снова: заметку создали, нашли поиском,
  // переключились на её вкладку.
  focusRequest: number;
  label: string;
};

// Коды те же, что у check_name в domain.rs: окно подсказывает заранее,
// а Rust проверяет ещё раз и отвечает теми же кодами.
export type NameProblem = "name_empty" | "name_forbidden" | "name_hidden" | "name_taken";

const NAME_PROBLEMS = new Set<string>(["name_empty", "name_forbidden", "name_hidden", "name_taken"]);

function isNameProblem(code: unknown): code is NameProblem {
  return typeof code === "string" && NAME_PROBLEMS.has(code);
}

// Отказ команды Rust приходит как AppError из error.rs: { kind, code }.
export function errorCodeOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return null;
}

// Код проверки имени окно показывает своей подсказкой, остальное общей.
export function nameProblemOf(error: unknown): NameProblem | null {
  const code = errorCodeOf(error);

  if (isNameProblem(code)) {
    return code;
  }

  return null;
}

// Имя заметки и папки над ней по пути: «Проекты/sapien/план.md» даёт
// «план» и ["Проекты", "sapien"].
export function notePlace(path: string) {
  const folders = path.split("/");
  const name = folders.pop() ?? path;

  return { title: noteTitle(name), folders };
}

// Символы, которые запрещает хоть одна система, и управляющие.
const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/u;

// Заметка в дереве показывается без расширения, как в Obsidian.
export function noteTitle(name: string) {
  return name.replace(/\.md$/i, "");
}

// Имя на диске: заметке `.md` дописывается, если его не написали.
function fileName(name: string, kind: EntryKind) {
  if (kind === "folder" || /.\.md$/i.test(name)) {
    return name;
  }

  return `${name}.md`;
}

// Занятость без учёта регистра: на macOS и Windows «План» и «план» это
// одно и то же имя.
export function checkName(name: string, kind: EntryKind, siblings: VaultEntry[]): NameProblem | null {
  const trimmed = name.trim();

  if (trimmed === "") {
    return "name_empty";
  }

  if (FORBIDDEN.test(trimmed)) {
    return "name_forbidden";
  }

  if (trimmed.startsWith(".")) {
    return "name_hidden";
  }

  const taken = fileName(trimmed, kind).toLowerCase();

  if (siblings.some((entry) => entry.name.toLowerCase() === taken)) {
    return "name_taken";
  }

  return null;
}

// «Без названия», а если занято, «Без названия 1», «Без названия 2» и дальше.
export function suggestName(base: string, kind: EntryKind, siblings: VaultEntry[]) {
  if (checkName(base, kind, siblings) === null) {
    return base;
  }

  for (let index = 1; ; index += 1) {
    const name = `${base} ${index}`;

    if (checkName(name, kind, siblings) === null) {
      return name;
    }
  }
}

// Содержимое папки по её пути, пустой путь это корень.
export function childrenOf(tree: VaultEntry[], folder: string): VaultEntry[] {
  if (folder === "") {
    return tree;
  }

  for (const entry of tree) {
    if (entry.kind === "folder" && (folder === entry.path || folder.startsWith(`${entry.path}/`))) {
      if (folder === entry.path) {
        return entry.children;
      }

      return childrenOf(entry.children, folder);
    }
  }

  return [];
}

export function parentOf(path: string) {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}

// Папка и все над ней: «a/b» даёт «a» и «a/b». Их раскрывают, чтобы новый
// элемент оказался на виду.
export function foldersDownTo(folder: string) {
  if (folder === "") {
    return [];
  }

  const parts = folder.split("/");

  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}
