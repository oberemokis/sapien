// Раскладка панелей сессии: одна панель или место, поделённое надвое.
// row делит слева направо, column сверху вниз. ratio это доля первой части.
export type Layout =
  | { kind: "pane"; id: string }
  | { kind: "split"; direction: "row" | "column"; ratio: number; first: Layout; second: Layout };

// С какой стороны от панели встаёт новая.
export type Side = "left" | "right" | "up" | "down";

// Панели сессии и та, в которой фокус.
export type Panes = { layout: Layout; active: string };

// Путь к делению от корня: first или second на каждом шаге.
export type SplitPath = ("first" | "second")[];

// Самая узкая часть деления: уже неё терминал не читается.
const MIN_RATIO = 0.1;

// Новая сессия начинается с одной панели. Её имя совпадает с сессией.
export function singlePane(session: string): Panes {
  return { layout: { kind: "pane", id: session }, active: session };
}

// Панели слева направо и сверху вниз.
export function panesIn(layout: Layout): string[] {
  if (layout.kind === "pane") {
    return [layout.id];
  }

  return [...panesIn(layout.first), ...panesIn(layout.second)];
}

function replace(layout: Layout, id: string, change: (pane: Layout) => Layout): Layout {
  if (layout.kind === "split") {
    return { ...layout, first: replace(layout.first, id, change), second: replace(layout.second, id, change) };
  }

  if (layout.id === id) {
    return change(layout);
  }

  return layout;
}

// Деление по стороне новой панели: направление и встаёт ли она первой.
const SIDES = {
  left: { direction: "row", before: true },
  right: { direction: "row", before: false },
  up: { direction: "column", before: true },
  down: { direction: "column", before: false },
} as const;

// Панель fresh встаёт со стороны side от панели target и делит её место
// пополам. Фокус переходит в новую.
export function splitPane(panes: Panes, target: string, side: Side, fresh: string): Panes {
  const added: Layout = { kind: "pane", id: fresh };
  const { direction, before } = SIDES[side];
  const layout = replace(panes.layout, target, (pane): Layout => {
    if (before) {
      return { kind: "split", direction, ratio: 0.5, first: added, second: pane };
    }

    return { kind: "split", direction, ratio: 0.5, first: pane, second: added };
  });

  return { layout, active: fresh };
}

function without(layout: Layout, id: string): Layout | null {
  if (layout.kind === "pane" && layout.id === id) {
    return null;
  }

  if (layout.kind === "pane") {
    return layout;
  }

  const first = without(layout.first, id);
  const second = without(layout.second, id);

  if (first === null || second === null) {
    return first ?? second;
  }

  return { ...layout, first, second };
}

// Закрытая панель отдаёт место соседке по делению, фокус уходит в неё же.
// Последнюю панель и панель не из этой сессии не закрыть: null.
export function closePane(panes: Panes, id: string): Panes | null {
  const index = panesIn(panes.layout).indexOf(id);
  const layout = without(panes.layout, id);

  if (layout === null || index === -1) {
    return null;
  }

  const open = panesIn(layout);
  let { active } = panes;

  if (active === id) {
    active = open[Math.min(index, open.length - 1)] ?? open[0] ?? active;
  }

  return { layout, active };
}

// Новая доля первой части деления по пути path.
export function resizeSplit(layout: Layout, path: SplitPath, ratio: number): Layout {
  if (layout.kind === "pane") {
    return layout;
  }

  const [step, ...rest] = path;

  if (step === undefined) {
    return { ...layout, ratio: Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio)) };
  }

  return { ...layout, [step]: resizeSplit(layout[step], rest, ratio) };
}

function isLayout(value: unknown): value is Layout {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const node = value as Record<string, unknown>;

  if (node.kind === "pane") {
    return typeof node.id === "string" && node.id !== "";
  }

  return (
    node.kind === "split" &&
    (node.direction === "row" || node.direction === "column") &&
    typeof node.ratio === "number" &&
    node.ratio >= MIN_RATIO &&
    node.ratio <= 1 - MIN_RATIO &&
    isLayout(node.first) &&
    isLayout(node.second)
  );
}

// Раскладки сессий из хранилища окна. Испорченная запись пропадает,
// и её сессия начинается с одной панели.
export function parsePanes(value: unknown): Record<string, Panes> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const entries = Object.entries(value).filter((entry): entry is [string, Panes] => {
    const panes = entry[1] as Partial<Panes> | null;

    return isLayout(panes?.layout) && typeof panes.active === "string" && panesIn(panes.layout).includes(panes.active);
  });

  return Object.fromEntries(entries);
}
