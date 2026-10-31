import { frontmatterMap, frontmatterValue, splitFrontmatter } from "@/core/markdown/frontmatter";

// Поля черновика в шапке заметки и их имена в YouTrack. Команда YouTrack
// ставит поле по имени, поэтому ключ шапки и имя связаны только здесь.
export const DRAFT_FIELDS = [
  { key: "type", name: "Type" },
  { key: "priority", name: "Priority" },
  { key: "assignee", name: "Assignee" },
  { key: "sprint", name: "Sprint" },
] as const;

export type DraftFieldKey = (typeof DRAFT_FIELDS)[number]["key"];

// Связи черновика в шапке, как LinkKind в src-tauri/src/modules/youtrack/domain.rs.
export const DRAFT_LINKS = [
  { key: "parent", kind: "parent" },
  { key: "depends_on", kind: "dependsOn" },
  { key: "blocks", kind: "blocks" },
  { key: "relates_to", kind: "relatesTo" },
] as const;

export type DraftLinkKey = (typeof DRAFT_LINKS)[number]["key"];

type LinkKind = (typeof DRAFT_LINKS)[number]["kind"];

// Номер опубликованной задачи в шапке.
export const ISSUE_KEY = "youtrack";

// Карта своих полей проекта в шапке.
export const CUSTOM_KEY = "fields";

export type TaskDraft = {
  project: string;
  // Номер задачи, если черновик уже опубликован.
  id: string | null;
  values: Record<DraftFieldKey, string>;
  // Свои поля проекта из карты fields.
  custom: { name: string; value: string }[];
  links: Record<DraftLinkKey, string[]>;
  summary: string;
  description: string;
};

// Что уходит в Rust, как Draft в domain.rs.
export type DraftRequest = {
  project: string;
  summary: string;
  description: string;
  fields: { name: string; value: string }[];
  links: { kind: LinkKind; id: string }[];
};

// Заметка хранилища, на которую может вести связь.
export type LinkedNote = { path: string; text: string };

function unquote(raw: string) {
  return raw.trim().replace(/^(["'])(.*)\1$/, "$2");
}

// Связи списком: «key: [a, b]», «key: a, b» или строками «- a» ниже.
// Пути черновиков бывают с пробелами, поэтому значения делятся только
// запятыми и строками, а не пробелами, как теги.
function linkList(yaml: string, key: string) {
  const lines = yaml.split("\n");
  const at = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));

  if (at === -1) {
    return [];
  }

  const line = lines[at] ?? "";
  const inline = line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^\[(.*)\]$/, "$1");
  const items = inline.split(",");

  if (inline === "") {
    for (const below of lines.slice(at + 1)) {
      const item = /^\s*-\s+(.*)$/.exec(below);

      if (item === null) {
        break;
      }

      items.push(item[1] ?? "");
    }
  }

  return items.map(unquote).filter((item) => item !== "");
}

// Текст без пустых разделов: заголовок, под которым до следующего заголовка
// того же или старшего уровня нет ничего, кроме пустых строк и таких же
// пустых подразделов. Так незаполненные разделы шаблона не уходят в задачу.
// Строка с «#» внутри блока кода заголовком не считается.
export function withoutEmptySections(markdown: string) {
  const lines = markdown.split("\n");
  const levels: number[] = [];
  let code = false;

  for (const line of lines) {
    const heading = /^(#{1,6})\s/.exec(line);
    let level = 0;

    if (/^\s*(```|~~~)/.test(line)) {
      code = !code;
    }

    if (heading !== null && !code) {
      level = (heading[1] ?? "").length;
    }

    levels.push(level);
  }

  const dropped = new Set<number>();

  for (const [index, level] of levels.entries()) {
    if (level === 0) {
      continue;
    }

    let end = index + 1;

    while (end < lines.length && ((levels[end] ?? 0) === 0 || (levels[end] ?? 0) > level)) {
      end += 1;
    }

    const empty = lines.slice(index + 1, end).every((line, offset) => (levels[index + 1 + offset] ?? 0) > 0 || line.trim() === "");

    if (empty) {
      dropped.add(index);

      // Пустые строки под выброшенным заголовком уходят с ним, иначе
      // на его месте осталась бы дыра.
      for (let blank = index + 1; blank < end && (lines[blank] ?? "").trim() === ""; blank += 1) {
        dropped.add(blank);
      }
    }
  }

  return lines
    .filter((_, index) => !dropped.has(index))
    .join("\n")
    .trim();
}

// Черновик задачи, если в шапке заметки есть ключ project, даже пустой:
// новая задача из шаблона без проекта по умолчанию тоже черновик, и форма
// просит вписать проект. Название задачи это заголовок первой строки текста,
// а без него имя заметки. Описание это текст под заголовком.
export function parseDraft(text: string, title: string): TaskDraft | null {
  const { yaml, body } = splitFrontmatter(text);
  const project = frontmatterValue(yaml, "project");

  if (project === null) {
    return null;
  }

  const trimmed = body.trim();
  const [first = "", ...rest] = trimmed.split("\n");
  const heading = /^#\s+(.+)$/.exec(first);
  let summary = title;
  let description = withoutEmptySections(trimmed);

  if (heading !== null) {
    summary = (heading[1] ?? "").trim();
    description = withoutEmptySections(rest.join("\n"));
  }

  const value = (key: string) => frontmatterValue(yaml, key) ?? "";

  return {
    project,
    id: value(ISSUE_KEY) || null,
    values: { type: value("type"), priority: value("priority"), assignee: value("assignee"), sprint: value("sprint") },
    custom: frontmatterMap(yaml, CUSTOM_KEY),
    links: {
      parent: linkList(yaml, "parent"),
      depends_on: linkList(yaml, "depends_on"),
      blocks: linkList(yaml, "blocks"),
      relates_to: linkList(yaml, "relates_to"),
    },
    summary,
    description,
  };
}

// Связь на путь заметки, а не на номер: она ведёт на другой черновик.
function isDraftPath(target: string) {
  return target.endsWith(".md");
}

// Связи на черновики встают номерами их задач. Черновик без номера ещё
// не задача: такие пути возвращаются в unpublished, и публиковать рано.
export function resolveLinks(draft: TaskDraft, notes: LinkedNote[]) {
  const unpublished: string[] = [];
  const idOf = (target: string) => {
    if (!isDraftPath(target)) {
      return target;
    }

    const note = notes.find((candidate) => candidate.path === target);
    const id = frontmatterValue(splitFrontmatter(note?.text ?? "").yaml, ISSUE_KEY) ?? "";

    if (id === "") {
      unpublished.push(target);
    }

    return id;
  };
  const links = {
    parent: draft.links.parent.map(idOf),
    depends_on: draft.links.depends_on.map(idOf),
    blocks: draft.links.blocks.map(idOf),
    relates_to: draft.links.relates_to.map(idOf),
  };

  return { draft: { ...draft, links }, unpublished };
}

export function draftRequest(draft: TaskDraft): DraftRequest {
  const fields = DRAFT_FIELDS.map(({ key, name }) => ({ name, value: draft.values[key] }));

  return {
    project: draft.project,
    summary: draft.summary,
    description: draft.description,
    fields: [...fields, ...draft.custom].filter((field) => field.value.trim() !== ""),
    links: DRAFT_LINKS.flatMap(({ key, kind }) => draft.links[key].map((id) => ({ kind, id }))),
  };
}

// Текст заметки с названием и описанием из YouTrack: шапка остаётся.
export function withIssueText(text: string, summary: string, description: string) {
  const { body } = splitFrontmatter(text);
  const head = text.slice(0, text.length - body.length);

  return `${head}# ${summary}\n\n${description}\n`;
}
