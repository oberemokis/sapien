import { projectOf } from "@/core/markdown/issues";
import { isDraftPath, noteTitle, parseDraft, type LinkedNote, type TaskDraft } from "./draft";
import type { EdgeKind, TaskGraph } from "./youtrack";

// Точка графа: задача YouTrack, черновик или то и другое сразу. key это
// номер задачи, а у неопубликованного черновика путь его заметки.
export type Point = {
  key: string;
  id: string | null;
  path: string | null;
  summary: string;
  state: string | null;
  resolved: boolean;
  assignee: string | null;
  project: string;
  url: string | null;
};

export type Line = { from: string; to: string; kind: EdgeKind };

export type GraphView = { points: Point[]; lines: Line[] };

export type GraphFilter = { state: string | null; assignee: string | null; kinds: EdgeKind[] };

type Drafted = { path: string; draft: TaskDraft };

function draftsOf(notes: LinkedNote[]): Drafted[] {
  return notes.flatMap(({ path, text }) => {
    const draft = parseDraft(text, noteTitle(path));

    if (draft === null) {
      return [];
    }

    return [{ path, draft }];
  });
}

export function lineKey({ from, to, kind }: Line) {
  return `${from}>${to}>${kind}`;
}

// Центр графа для черновика: номер его задачи, а без номера путь заметки.
export function centerOf(path: string, notes: LinkedNote[]) {
  const text = notes.find((note) => note.path === path)?.text ?? "";

  return parseDraft(text, noteTitle(path))?.id ?? path;
}

// Линии из шапок черновиков. Связь на путь другого черновика встаёт его
// номером, если он опубликован: точка у задачи и её черновика одна.
function draftLines(drafts: Drafted[]) {
  const idByPath = new Map(drafts.flatMap(({ path, draft }) => [[path, draft.id ?? path] as const]));
  const keyOf = (target: string) => idByPath.get(target) ?? target;

  return drafts.flatMap(({ path, draft }) => {
    const key = draft.id ?? path;
    const { parent, depends_on, blocks, relates_to } = draft.links;

    return [
      ...parent.map((target): Line => ({ from: keyOf(target), to: key, kind: "subtask" })),
      ...depends_on.map((target): Line => ({ from: keyOf(target), to: key, kind: "blocks" })),
      ...blocks.map((target): Line => ({ from: key, to: keyOf(target), kind: "blocks" })),
      ...relates_to.map((target): Line => {
        const [from = key, to = key] = [key, keyOf(target)].toSorted();

        return { from, to, kind: "relates" };
      }),
    ];
  });
}

// Сколько связей от start до каждой точки, не дальше depth. Направление
// линий здесь не важно: граф показывает окрестность задачи.
function distances(lines: Line[], start: string, depth: number) {
  const near = new Map<string, string[]>();

  for (const { from, to } of lines) {
    near.set(from, [...(near.get(from) ?? []), to]);
    near.set(to, [...(near.get(to) ?? []), from]);
  }

  const found = new Map([[start, 0]]);
  let frontier = [start];

  for (let step = 1; step <= depth; step += 1) {
    frontier = frontier.flatMap((key) => near.get(key) ?? []).filter((key) => !found.has(key));

    for (const key of frontier) {
      found.set(key, step);
    }
  }

  return found;
}

// Номера задач, с которых Rust начинает обход: сам центр или, у
// неопубликованного черновика, задачи, до которых он дотягивается через
// шапки черновиков.
export function graphRoots(center: string, depth: number, notes: LinkedNote[]) {
  if (!isDraftPath(center)) {
    return [center];
  }

  const reach = distances(draftLines(draftsOf(notes)), center, depth);

  return [...reach.keys()].filter((key) => !isDraftPath(key)).toSorted();
}

function draftPoint(key: string, path: string, draft: TaskDraft): Point {
  return {
    key,
    id: draft.id,
    path,
    summary: draft.summary,
    state: null,
    resolved: false,
    assignee: draft.values.assignee || null,
    project: draft.project,
    url: null,
  };
}

// Точки и линии вокруг center не дальше depth связей: задачи из ответа
// YouTrack и черновики хранилища. Опубликованный черновик это его задача,
// с путём заметки, чтобы клик открывал заметку. Номер, о котором YouTrack
// ещё не ответил, остаётся точкой без названия.
export function buildView(center: string, depth: number, graph: TaskGraph | undefined, notes: LinkedNote[]): GraphView {
  const drafts = draftsOf(notes);
  const points = new Map<string, Point>();

  for (const node of graph?.nodes ?? []) {
    points.set(node.id, { key: node.id, path: null, ...node });
  }

  for (const { path, draft } of drafts) {
    const key = draft.id ?? path;
    const known = points.get(key);

    if (known === undefined) {
      points.set(key, draftPoint(key, path, draft));
    } else {
      points.set(key, { ...known, path });
    }
  }

  const unique = new Map<string, Line>();

  for (const line of [...(graph?.edges ?? []), ...draftLines(drafts)]) {
    // Связь на черновик, которого нет в хранилище, вести некуда.
    if (line.from !== line.to && !(isDraftPath(line.from) && !points.has(line.from)) && !(isDraftPath(line.to) && !points.has(line.to))) {
      unique.set(lineKey(line), line);
    }
  }

  const lines = [...unique.values()];
  const reach = distances(lines, center, depth);

  for (const key of reach.keys()) {
    if (!points.has(key) && !isDraftPath(key)) {
      points.set(key, {
        key,
        id: key,
        path: null,
        summary: "",
        state: null,
        resolved: false,
        assignee: null,
        project: projectOf(key),
        url: null,
      });
    }
  }

  return {
    points: [...points.values()].filter((point) => reach.has(point.key)),
    lines: lines.filter((line) => reach.has(line.from) && reach.has(line.to)),
  };
}

// Фильтр сверху окна. Центр виден всегда, линия видна, когда видны оба
// её конца и её вид выбран.
export function filterView({ points, lines }: GraphView, center: string, filter: GraphFilter): GraphView {
  const shown = points.filter(
    (point) =>
      point.key === center ||
      ((filter.state === null || point.state === filter.state) &&
        (filter.assignee === null || point.assignee === filter.assignee)),
  );
  const keys = new Set(shown.map((point) => point.key));

  return {
    points: shown,
    lines: lines.filter((line) => filter.kinds.includes(line.kind) && keys.has(line.from) && keys.has(line.to)),
  };
}

function blocksFrom(lines: Line[]) {
  const next = new Map<string, Line[]>();

  for (const line of lines.filter(({ kind }) => kind === "blocks")) {
    next.set(line.from, [...(next.get(line.from) ?? []), line]);
  }

  return next;
}

// Всё, что блокирует задачу key, прямо и через другие: линии цепочки.
export function blockingChain(lines: Line[], key: string) {
  const chain = new Set<string>();
  let frontier = [key];
  const seen = new Set(frontier);

  while (frontier.length > 0) {
    const into = lines.filter((line) => line.kind === "blocks" && frontier.includes(line.to));

    for (const line of into) {
      chain.add(lineKey(line));
    }

    frontier = into.map((line) => line.from).filter((from) => !seen.has(from));
    frontier.forEach((from) => seen.add(from));
  }

  return chain;
}

// Линии «блокирует», которые лежат на цикле: от их конца можно вернуться
// к началу по тем же линиям.
export function cycleLines(lines: Line[]) {
  const next = blocksFrom(lines);
  const reaches = (start: string, goal: string) => {
    const seen = new Set<string>();
    const stack = [start];

    while (stack.length > 0) {
      const key = stack.pop() ?? "";

      if (key === goal) {
        return true;
      }

      if (!seen.has(key)) {
        seen.add(key);
        stack.push(...(next.get(key) ?? []).map((line) => line.to));
      }
    }

    return false;
  };

  return new Set(lines.filter((line) => line.kind === "blocks" && reaches(line.to, line.from)).map(lineKey));
}

// Статусы и исполнители точек для фильтра, по алфавиту.
export function choicesOf(points: Point[], field: "state" | "assignee") {
  const values = points.flatMap((point) => point[field] ?? []);

  return [...new Set(values)].toSorted((a, b) => a.localeCompare(b));
}
