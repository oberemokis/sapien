import {
  CUSTOM_KEY,
  DRAFT_FIELDS,
  DRAFT_LINKS,
  isChildOf,
  isDraftPath,
  noteTitle,
  parseDraft,
  type LinkedNote,
  type TaskDraft,
} from "./draft";
import type { Checked, Similar } from "./youtrack";

export type FindingCode =
  | "project_empty"
  | "project_missing"
  | "required"
  | "cycle"
  | "draft_missing"
  | "issue_missing"
  | "issue_closed"
  | "parent_project"
  | "later_sprint"
  | "later_due"
  | "no_check"
  | "duplicate";

// Публикацию держат находки, с которыми задача выйдет неверной или
// не создастся вовсе. С остальными YouTrack задачу примет, и бывают
// причины сделать так нарочно: они только предупреждают.
const BLOCKING = new Set<FindingCode>([
  "project_empty",
  "project_missing",
  "required",
  "cycle",
  "draft_missing",
  "issue_missing",
]);

// Подстановки в текст находки: номер задачи, путь или имя поля, о котором
// она, и что нужно сказать о нём ещё.
type FindingValues = { subject?: string; project?: string; summary?: string; words?: string };

export type Finding = {
  code: FindingCode;
  blocking: boolean;
  // Ключ шапки, к полю которого ведёт находка: «fields.Имя» у своих полей.
  field: string | null;
  values: FindingValues;
  // Черновики, которые находка называет: их можно открыть.
  drafts: string[];
};

function finding(code: FindingCode, field: string | null, values: FindingValues = {}, drafts: string[] = []) {
  return { code, blocking: BLOCKING.has(code), field, values, drafts };
}

type Node = { path: string; draft: TaskDraft };

// Черновики хранилища. Этот берётся как есть в форме: в заметках может
// лежать текст до последней правки.
function nodesOf(path: string, draft: TaskDraft, notes: LinkedNote[]) {
  const nodes: Node[] = [{ path, draft }];

  for (const note of notes) {
    const parsed = parseDraft(note.text, noteTitle(note.path));

    if (note.path !== path && parsed !== null) {
      nodes.push({ path: note.path, draft: parsed });
    }
  }

  return nodes;
}

// Черновик, на который ведёт связь: по пути или по номеру его задачи.
function nodeOf(nodes: Node[], target: string) {
  if (isDraftPath(target)) {
    return nodes.find((node) => node.path === target);
  }

  return nodes.find((node) => node.draft.id === target);
}

// Кто от кого зависит. «A зависит от B» и «B блокирует A» это одно
// ребро A → B.
function dependencies(nodes: Node[]) {
  const edges = new Map<string, string[]>();
  const add = (from: string, to: string) => edges.set(from, [...(edges.get(from) ?? []), to]);

  for (const node of nodes) {
    for (const target of node.draft.links.depends_on) {
      const to = nodeOf(nodes, target);

      if (to !== undefined) {
        add(node.path, to.path);
      }
    }

    for (const target of node.draft.links.blocks) {
      const from = nodeOf(nodes, target);

      if (from !== undefined) {
        add(from.path, node.path);
      }
    }
  }

  return edges;
}

// Кратчайший цикл через этот черновик: черновики по зависимостям от него
// и до того, что зависит от него самого. Цикла нет, пусто.
function cycleThrough(path: string, edges: Map<string, string[]>) {
  const queue = [[path]];
  const seen = new Set([path]);

  for (const route of queue) {
    for (const next of edges.get(route.at(-1) ?? "") ?? []) {
      if (next === path) {
        return route;
      }

      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...route, next]);
      }
    }
  }

  return [];
}

// Эпик и черновики, у которых он в parent, в порядке публикации: эпик
// первым, задача после тех, от кого зависит, чтобы связь вставала номером.
// Задачи в цикле идут в конце: публикацию их всё равно держит находка.
export function familyOf(epic: string, draft: TaskDraft, notes: LinkedNote[]) {
  const nodes = nodesOf(epic, draft, notes);
  const edges = dependencies(nodes);
  const order: Node[] = [];
  let left = nodes.filter((node) => node.path !== epic && isChildOf(node.draft, epic, draft.id));

  while (left.length > 0) {
    const waiting = new Set(left.map((node) => node.path));
    const ready = new Set(left.filter((node) => (edges.get(node.path) ?? []).every((to) => !waiting.has(to))));

    if (ready.size === 0) {
      order.push(...left);
      break;
    }

    order.push(...ready);
    left = left.filter((node) => !ready.has(node));
  }

  return [{ path: epic, draft }, ...order];
}

// Номер спринта: последнее число в имени, как в «Sprint 12».
function sprintNumber(sprint: string | null) {
  const match = /(\d+)\D*$/.exec(sprint ?? "");

  if (match === null) {
    return null;
  }

  return Number(match[1]);
}

// Срок черновика: своё поле «Due Date» с датой вроде 2026-11-15.
function dueOf(draft: TaskDraft) {
  const time = Date.parse(draft.custom.find((entry) => entry.name === "Due Date")?.value ?? "");

  if (Number.isNaN(time)) {
    return null;
  }

  return time;
}

function isLater(own: number | null, theirs: number | null) {
  return own !== null && theirs !== null && theirs > own;
}

// Проект задачи по номеру вроде SAP-12. У внутреннего номера 2-345
// проекта не видно.
function projectOfId(id: string) {
  const project = id.slice(0, id.lastIndexOf("-"));

  if (/^\d*$/.test(project)) {
    return null;
  }

  return project;
}

// Раздел с критериями приёмки. Пустые разделы из описания уже убраны,
// поэтому заголовок значит, что под ним что-то есть.
const CHECK_SECTION = /^#{1,6}\s+(Проверка|Критерии приёмки)\s*$/im;

// Находки, которым сеть не нужна: их видно из заметок хранилища, и они
// пересчитываются с каждой правкой.
export function localFindings(path: string, draft: TaskDraft, notes: LinkedNote[]) {
  const nodes = nodesOf(path, draft, notes);
  const findings: Finding[] = [];

  if (draft.project.trim() === "") {
    findings.push(finding("project_empty", "project"));
  }

  for (const { key } of DRAFT_LINKS) {
    for (const target of draft.links[key]) {
      const node = nodeOf(nodes, target);

      if (isDraftPath(target) && node === undefined) {
        findings.push(finding("draft_missing", key, { subject: target }));
      }

      const project = node?.draft.project ?? projectOfId(target);

      if (key === "parent" && project && draft.project && project.toLowerCase() !== draft.project.toLowerCase()) {
        findings.push(finding("parent_project", key, { subject: target, project }));
      }

      if (key === "depends_on" && node !== undefined) {
        if (isLater(sprintNumber(draft.values.sprint), sprintNumber(node.draft.values.sprint))) {
          findings.push(finding("later_sprint", key, { subject: target }));
        }

        if (isLater(dueOf(draft), dueOf(node.draft))) {
          findings.push(finding("later_due", key, { subject: target }));
        }
      }
    }
  }

  const cycle = cycleThrough(path, dependencies(nodes));

  if (cycle.length > 0) {
    findings.push(finding("cycle", "depends_on", { subject: [...cycle, path].map(noteTitle).join(" → ") }, cycle));
  }

  if (!CHECK_SECTION.test(draft.description)) {
    findings.push(finding("no_check", null));
  }

  return findings;
}

// Номера задач из связей черновика: то, о чём проверка спрашивает YouTrack.
export function linkedIssues(draft: TaskDraft) {
  return DRAFT_LINKS.flatMap(({ key }) => draft.links[key]).filter((target) => !isDraftPath(target));
}

// Находки по ответу YouTrack. Ответ мог устареть: что человек с тех пор
// поправил (убрал связь, вписал поле), в находки уже не попадает.
export function remoteFindings(path: string, draft: TaskDraft, notes: LinkedNote[], checked: Checked) {
  const nodes = nodesOf(path, draft, notes);
  const findings: Finding[] = [];

  if (!checked.projectFound && draft.project !== "") {
    findings.push(finding("project_missing", "project", { subject: draft.project }));
  }

  for (const name of checked.missing) {
    const known = DRAFT_FIELDS.find((field) => field.name.toLowerCase() === name.toLowerCase());
    const custom = draft.custom.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    let filled = (custom?.value ?? "") !== "";
    let field = `${CUSTOM_KEY}.${name}`;

    if (known !== undefined) {
      filled ||= draft.values[known.key] !== "";
      field = known.key;
    }

    if (!filled) {
      findings.push(finding("required", field, { subject: name }));
    }
  }

  for (const { key } of DRAFT_LINKS) {
    for (const target of draft.links[key]) {
      const facts = checked.issues.find((issue) => issue.id === target);

      // Опубликованный черновик проверяется по заметке, а не по YouTrack.
      if (facts === undefined || nodeOf(nodes, target) !== undefined) {
        continue;
      }

      if (!facts.found) {
        findings.push(finding("issue_missing", key, { subject: target }));
        continue;
      }

      if (facts.resolved) {
        findings.push(finding("issue_closed", key, { subject: target }));
      }

      if (key === "depends_on" && isLater(sprintNumber(draft.values.sprint), sprintNumber(facts.sprint))) {
        findings.push(finding("later_sprint", key, { subject: target }));
      }

      if (key === "depends_on" && isLater(dueOf(draft), facts.due)) {
        findings.push(finding("later_due", key, { subject: target }));
      }
    }
  }

  return findings;
}

// Слова, как их берёт поиск похожих в Rust: от трёх букв или цифр.
function wordsOf(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => [...word].length > 2);
}

// Кандидаты в дубли из найденного поиском: у кандидата с названием черновика
// общие хотя бы два слова, а у названия из одного слова это слово. Сама
// задача, её связи и отмеченные «это не дубль» не в счёт.
export function duplicateFindings(draft: TaskDraft, similar: Similar[]) {
  const words = new Set(wordsOf(draft.summary));
  const enough = Math.max(1, Math.min(2, words.size));
  const skipped = new Set([draft.id, ...draft.notDuplicates, ...DRAFT_LINKS.flatMap(({ key }) => draft.links[key])]);

  return similar
    .filter((issue) => !skipped.has(issue.id))
    .map((issue) => ({ issue, shared: [...new Set(wordsOf(issue.summary).filter((word) => words.has(word)))] }))
    .filter(({ shared }) => shared.length >= enough)
    .toSorted((a, b) => b.shared.length - a.shared.length)
    .slice(0, 5)
    .map(({ issue, shared }) =>
      finding("duplicate", null, { subject: issue.id, summary: issue.summary, words: shared.join(", ") }),
    );
}
