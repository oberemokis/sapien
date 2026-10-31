import { describe, expect, it } from "vitest";
import { blockingChain, buildView, centerOf, cycleLines, filterView, graphRoots, lineKey, type Line } from "./graph";
import { placeBodies, step } from "./layout";
import type { TaskGraph } from "./youtrack";

function node(id: string, state: string | null = "Open", extra: Partial<TaskGraph["nodes"][number]> = {}) {
  return {
    id,
    summary: `Задача ${id}`,
    state,
    resolved: false,
    assignee: null,
    project: id.split("-")[0] ?? "",
    url: `https://acme.youtrack.cloud/issue/${id}`,
    ...extra,
  };
}

// Эпик SAP-1 с подзадачей SAP-2, SAP-2 блокирует SAP-3, SAP-3 связана
// с WEB-4 из другого проекта.
const GRAPH: TaskGraph = {
  nodes: [node("SAP-1"), node("SAP-2", "In Progress", { assignee: "Анна" }), node("SAP-3"), node("WEB-4", "Done", { resolved: true })],
  edges: [
    { from: "SAP-1", to: "SAP-2", kind: "subtask" },
    { from: "SAP-2", to: "SAP-3", kind: "blocks" },
    { from: "SAP-3", to: "WEB-4", kind: "relates" },
  ],
};

// Черновик эпика опубликован как SAP-1, черновик письма ещё нет: он
// подзадача эпика по пути и зависит от SAP-3.
const NOTES = [
  { path: "Задачи/Вход.md", text: "---\nproject: SAP\nyoutrack: SAP-1\n---\n# Вход по ссылке" },
  {
    path: "Задачи/Письмо.md",
    text: "---\nproject: SAP\nparent: Задачи/Вход.md\ndepends_on: [SAP-3, SAP-77]\nrelates_to: [Задачи/Нет.md]\n---\n# Письмо",
  },
  { path: "Идеи.md", text: "# Идеи" },
];

function keys(points: { key: string }[]) {
  return points.map((point) => point.key).toSorted();
}

describe("граф связей", () => {
  it("опубликованный черновик это его задача, неопубликованный встаёт точкой по пути", () => {
    const view = buildView("SAP-1", 2, GRAPH, NOTES);

    expect(keys(view.points)).toEqual(["SAP-1", "SAP-2", "SAP-3", "SAP-77", "Задачи/Письмо.md"]);
    expect(view.points.find((point) => point.key === "SAP-1")?.path).toBe("Задачи/Вход.md");
    expect(view.lines).toContainEqual({ from: "SAP-1", to: "Задачи/Письмо.md", kind: "subtask" });
    // Номер, о котором YouTrack не ответил, остаётся точкой без названия.
    expect(view.points.find((point) => point.key === "SAP-77")).toMatchObject({ summary: "", url: null, project: "SAP" });
    // Связь на черновик, которого нет в хранилище, вести некуда.
    expect(view.lines.some((line) => line.to.endsWith("Нет.md") || line.from.endsWith("Нет.md"))).toBe(false);
  });

  it("глубина обрезает граф по числу связей от центра", () => {
    expect(keys(buildView("SAP-1", 1, GRAPH, NOTES).points)).toEqual(["SAP-1", "SAP-2", "Задачи/Письмо.md"]);
    expect(keys(buildView("SAP-1", 3, GRAPH, NOTES).points)).toContain("WEB-4");
  });

  it("центр это номер задачи черновика, а у неопубликованного путь и номера его связей", () => {
    expect(centerOf("Задачи/Вход.md", NOTES)).toBe("SAP-1");
    expect(centerOf("Задачи/Письмо.md", NOTES)).toBe("Задачи/Письмо.md");
    expect(graphRoots("Задачи/Письмо.md", 1, NOTES)).toEqual(["SAP-1", "SAP-3", "SAP-77"]);
    expect(graphRoots("SAP-1", 2, NOTES)).toEqual(["SAP-1"]);
  });

  it("задача без связей это одна точка", () => {
    const view = buildView("SAP-9", 2, { nodes: [node("SAP-9")], edges: [] }, []);

    expect(keys(view.points)).toEqual(["SAP-9"]);
    expect(view.lines).toEqual([]);
  });

  it("цепочка блокирующих идёт через несколько задач, цикл A, B, A выделен", () => {
    const lines: Line[] = [
      { from: "A", to: "B", kind: "blocks" },
      { from: "B", to: "A", kind: "blocks" },
      { from: "C", to: "A", kind: "blocks" },
      { from: "D", to: "C", kind: "blocks" },
      { from: "A", to: "E", kind: "relates" },
      { from: "E", to: "F", kind: "blocks" },
    ];

    expect([...blockingChain(lines, "C")]).toEqual(["D>C>blocks"]);
    expect([...blockingChain(lines, "A")].toSorted()).toEqual(["B>A>blocks", "C>A>blocks", "D>C>blocks", "A>B>blocks"].toSorted());
    expect([...cycleLines(lines)].toSorted()).toEqual(["A>B>blocks", "B>A>blocks"]);
    expect(lineKey(lines[4] as Line)).toBe("A>E>relates");
  });

  it("фильтр оставляет центр и линии выбранных видов между видимыми точками", () => {
    const view = buildView("SAP-1", 3, GRAPH, []);
    const byState = filterView(view, "SAP-1", { state: "In Progress", assignee: null, kinds: ["subtask", "blocks", "relates"] });

    expect(keys(byState.points)).toEqual(["SAP-1", "SAP-2"]);
    expect(byState.lines).toEqual([{ from: "SAP-1", to: "SAP-2", kind: "subtask" }]);

    const noSubtasks = filterView(view, "SAP-1", { state: null, assignee: null, kinds: ["blocks", "relates"] });

    expect(noSubtasks.points).toHaveLength(4);
    expect(noSubtasks.lines.map((line) => line.kind)).toEqual(["blocks", "relates"]);
    expect(keys(filterView(view, "SAP-1", { state: null, assignee: "Анна", kinds: [] }).points)).toEqual(["SAP-1", "SAP-2"]);
  });
});

describe("раскладка графа", () => {
  it("связанные точки сходятся ближе несвязанных, закреплённая стоит", () => {
    const bodies = placeBodies(["a", "b", "c", "d"], [], new Map());
    const pinned = bodies[3];

    if (pinned === undefined) {
      throw new Error("нет точки");
    }

    pinned.fixed = true;
    const at = { x: pinned.x, y: pinned.y };
    let alpha = 1;

    for (let tick = 0; tick < 300; tick += 1) {
      step(bodies, [[0, 1]], alpha);
      alpha *= 0.98;
    }

    const [a, b, c] = bodies;
    const distance = (p = a, q = b) => Math.hypot((p?.x ?? 0) - (q?.x ?? 0), (p?.y ?? 0) - (q?.y ?? 0));

    expect(bodies.every((body) => Number.isFinite(body.x) && Number.isFinite(body.y))).toBe(true);
    expect(distance(a, b)).toBeLessThan(distance(a, c));
    expect({ x: pinned.x, y: pinned.y }).toEqual(at);
  });

  it("точка с прежним местом остаётся на нём, новая встаёт рядом с соседом", () => {
    const previous = new Map(placeBodies(["a"], [], new Map()).map((body) => [body.key, body]));
    const bodies = placeBodies(["a", "b", "c", "d"], [[0, 2]], previous);
    const [a, b, c] = bodies;

    expect(a).toBe(previous.get("a"));
    expect(Math.hypot((c?.x ?? 0) - (a?.x ?? 0), (c?.y ?? 0) - (a?.y ?? 0))).toBeCloseTo(90);
    expect(Math.hypot(b?.x ?? 0, b?.y ?? 0)).toBeGreaterThan(200);
    expect(new Set(bodies.map((body) => `${body.x}:${body.y}`)).size).toBe(4);
  });

  it("первым встаёт центр, его соседи вокруг него", () => {
    const [a, center] = placeBodies(["a", "center"], [[0, 1]], new Map(), "center");

    expect(center).toMatchObject({ x: 0, y: 0 });
    expect(Math.hypot(a?.x ?? 0, a?.y ?? 0)).toBeCloseTo(90);
  });
});
