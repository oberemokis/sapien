import { describe, expect, it } from "vitest";
import { closePane, panesIn, parsePanes, resizeSplit, singlePane, splitPane, type Layout } from "./panes";

// a справа делится на b, затем b снизу на c: a | (b / c).
const THREE = splitPane(splitPane(singlePane("a"), "a", "right", "b"), "b", "down", "c");

// Раскладка рисунком: «|» делит слева направо, «/» сверху вниз.
const MARKS = { row: "|", column: "/" };

function drawn(layout: Layout): string {
  if (layout.kind === "pane") {
    return layout.id;
  }

  return `(${drawn(layout.first)} ${MARKS[layout.direction]} ${drawn(layout.second)})`;
}

describe("деление панели", () => {
  it.each([
    ["вправо", "right", "(a | n)"],
    ["влево", "left", "(n | a)"],
    ["вниз", "down", "(a / n)"],
    ["вверх", "up", "(n / a)"],
  ] as const)("%s: новая панель встаёт с этой стороны, фокус в ней", (_, side, picture) => {
    const panes = splitPane(singlePane("a"), "a", side, "n");

    expect(drawn(panes.layout)).toBe(picture);
    expect(panes.active).toBe("n");
  });

  it("делится только нужная панель, соседние остаются на местах", () => {
    expect(drawn(THREE.layout)).toBe("(a | (b / c))");
    expect(panesIn(THREE.layout)).toEqual(["a", "b", "c"]);
  });
});

describe("закрытие панели", () => {
  it("место закрытой панели уходит соседке, фокус в соседку", () => {
    const closed = closePane(THREE, "c");

    expect(drawn(closed?.layout as Layout)).toBe("(a | b)");
    expect(closed?.active).toBe("b");
  });

  it("закрытая фоновая панель фокус не трогает", () => {
    const closed = closePane({ ...THREE, active: "c" }, "a");

    expect(drawn(closed?.layout as Layout)).toBe("(b / c)");
    expect(closed?.active).toBe("c");
  });

  it("последнюю панель и чужую не закрыть", () => {
    expect(closePane(singlePane("a"), "a")).toBeNull();
    expect(closePane(THREE, "x")).toBeNull();
  });
});

describe("размер деления", () => {
  it("меняется у нужного деления и не уводит часть в ноль", () => {
    const wider = resizeSplit(THREE.layout, [], 0.7);
    const lower = resizeSplit(THREE.layout, ["second"], 0.02);
    const past = resizeSplit(THREE.layout, [], 1.4);

    expect(wider).toMatchObject({ ratio: 0.7, second: { ratio: 0.5 } });
    expect(lower).toMatchObject({ ratio: 0.5, second: { ratio: 0.1 } });
    expect(past).toMatchObject({ ratio: 0.9 });
  });
});

describe("раскладки из хранилища", () => {
  it("целые проходят, испорченные пропадают", () => {
    expect(
      parsePanes({
        s1: THREE,
        s2: { layout: { kind: "pane", id: "s2" }, active: "x" },
        s3: { layout: { kind: "split", direction: "row", ratio: 5, first: { kind: "pane", id: "a" } }, active: "a" },
        s4: null,
      }),
    ).toEqual({ s1: THREE });
    expect(parsePanes("мусор")).toEqual({});
  });
});
