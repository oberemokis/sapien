import {
  frontmatterValue,
  splitFrontmatter,
  withFrontmatterList,
  withFrontmatterValue,
} from "@/core/markdown/frontmatter";
import {
  draftNames,
  folderOf,
  isChildOf,
  notePath,
  noteTitle,
  parseDraft,
  type LinkedNote,
  type TaskDraft,
} from "./draft";

// Ключ шапки заметки-разбивки: путь черновика, который она разбивает.
export const BREAKDOWN_KEY = "breakdown";

// Оценка размером в шапке черновика. В YouTrack она не уходит.
export const SIZE_KEY = "size";

const SIZES = new Set(["S", "M", "L"]);

export type BreakdownTask = {
  number: number;
  title: string;
  type: string;
  size: string;
  depends: number[];
  description: string;
};

export type BreakdownProblemCode = "heading" | "duplicate" | "size" | "depends";

// Строка разбивки, которая не разобралась, и почему.
export type BreakdownProblem = { code: BreakdownProblemCode; line: string };

// Заметка-разбивка лежит рядом с тем, что разбивает.
export function breakdownPath(epic: string) {
  return notePath(folderOf(epic), `${noteTitle(epic)}. Разбивка`);
}

// Задание агенту: прочитать черновик, найти уже разбитое и записать
// разбивку заметкой в виде, который разбирает parseBreakdown.
export function breakdownTask(epic: string, id: string | null) {
  let existing = "";

  if (id !== null) {
    existing = ` и подзадачи в YouTrack запросом «subtask of: ${id}»`;
  }

  return `Разбей задачу «${epic}» на задачи одного уровня.

Прочитай её заметку и заметки, на которые она ссылается. Найди, что уже разбито: черновики, у которых в parent её путь (search_notes по пути)${existing}. Их не предлагай заново.

Запиши разбивку заметкой «${breakdownPath(epic)}» через write_note ровно в таком виде:

---
${BREAKDOWN_KEY}: ${epic}
---
# ${noteTitle(epic)}. Разбивка

## 1. Название задачи

- Тип: Task
- Оценка: M
- Зависит от: 2, 3

Одно-два предложения: что сделать и зачем.

Тип это Task, Feature или Bug. Оценка это S, M или L. «Зависит от» ставь только на номера задач этой разбивки, а без зависимостей строку не пиши. Других заметок не создавай и не меняй. В ответе коротко перечисли задачи.`;
}

const HEADING = /^##\s+(.*)$/;
const NUMBERED = /^(\d+)[.)]\s+(.+)$/;
const META = /^[-*]\s*(тип|оценка|зависит от)\s*:\s*(.*)$/i;

type Parsed = BreakdownTask & { line: string; dependsText: string };

// Разбивка из заметки: задачи с заголовками «## N. Название», под каждой
// строки «- Тип:», «- Оценка:», «- Зависит от:» и описание. Чего не понять,
// уходит в problems со строкой, где это написано. epic это путь из шапки,
// null у заметки, которая не разбивка.
export function parseBreakdown(text: string) {
  const { yaml, body } = splitFrontmatter(text);
  const epic = frontmatterValue(yaml, BREAKDOWN_KEY);
  const parsed: Parsed[] = [];
  const problems: BreakdownProblem[] = [];
  let current: Parsed | null = null;

  for (const line of body.split("\n")) {
    const heading = HEADING.exec(line);

    if (heading !== null) {
      const numbered = NUMBERED.exec((heading[1] ?? "").trim());

      current = null;

      if (numbered === null) {
        problems.push({ code: "heading", line });
        continue;
      }

      current = {
        number: Number(numbered[1]),
        title: (numbered[2] ?? "").trim(),
        type: "",
        size: "",
        depends: [],
        description: "",
        line,
        dependsText: "",
      };
      parsed.push(current);
      continue;
    }

    if (current === null) {
      continue;
    }

    const meta = META.exec(line.trim());
    const key = meta?.[1]?.toLowerCase();
    const value = (meta?.[2] ?? "").trim();

    if (key === "тип") {
      current.type = value;
    } else if (key === "оценка") {
      current.size = value.toUpperCase();
    } else if (key === "зависит от") {
      current.dependsText = value;
    } else {
      current.description += `${line}\n`;
    }
  }

  const numbers = new Set<number>();

  for (const task of parsed) {
    if (numbers.has(task.number)) {
      problems.push({ code: "duplicate", line: task.line });
    }

    numbers.add(task.number);

    if (task.size !== "" && !SIZES.has(task.size)) {
      problems.push({ code: "size", line: task.line });
    }
  }

  for (const task of parsed) {
    const items = task.dependsText.split(/[\s,]+/).filter((item) => item !== "");

    task.depends = items.map(Number);

    if (items.some((item) => !/^\d+$/.test(item) || !numbers.has(Number(item)) || Number(item) === task.number)) {
      problems.push({ code: "depends", line: task.line });
    }
  }

  const tasks: BreakdownTask[] = parsed.map(({ line: _line, dependsText: _depends, description, ...task }) => ({
    ...task,
    description: description.trim(),
  }));

  return { epic, tasks, problems };
}

function draftText(task: BreakdownTask, epic: string, project: string, pathOf: Map<number, string>) {
  const body = [`# ${task.title}`, task.description, "## Проверка\n"].filter((part) => part !== "").join("\n\n");
  let text = `---\n${`project: ${project}`.trim()}\n---\n${body}`;

  text = withFrontmatterValue(text, "type", task.type || "Task");
  text = withFrontmatterValue(text, SIZE_KEY, task.size);
  text = withFrontmatterList(text, "parent", [epic]);
  text = withFrontmatterList(
    text,
    "depends_on",
    task.depends.map((number) => pathOf.get(number) ?? ""),
  );

  return text;
}

// Черновики из разбивки рядом с эпиком, в его проекте. У задачи, для которой
// уже есть черновик с тем же названием и тем же эпиком, второго не будет,
// а связи на неё ведут на прежний.
export function breakdownNotes(epic: string, epicDraft: TaskDraft, tasks: BreakdownTask[], notes: LinkedNote[]) {
  const folder = folderOf(epic);
  const children = new Map<string, string>();

  for (const note of notes) {
    const draft = parseDraft(note.text, noteTitle(note.path));

    if (note.path !== epic && draft !== null && isChildOf(draft, epic, epicDraft.id)) {
      children.set(draft.summary.trim().toLowerCase(), note.path);
    }
  }

  const fresh = tasks.filter((task) => !children.has(task.title.toLowerCase()));
  const names = draftNames(
    fresh.map((task) => task.title),
    notes.map((note) => note.path),
    folder,
  );
  const pathOf = new Map<number, string>();

  for (const task of tasks) {
    const existing = children.get(task.title.toLowerCase());

    if (existing !== undefined) {
      pathOf.set(task.number, existing);
    }
  }

  for (const [index, task] of fresh.entries()) {
    pathOf.set(task.number, notePath(folder, names[index] ?? ""));
  }

  return {
    folder,
    create: fresh.map((task, index) => ({
      name: names[index] ?? "",
      text: draftText(task, epic, epicDraft.project, pathOf),
    })),
    existing: tasks.length - fresh.length,
  };
}
