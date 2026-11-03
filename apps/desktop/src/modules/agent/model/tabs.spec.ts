import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./sessions";
import { closeTab, moveTab, NO_TABS, openTab, parseTabs, pinTab, visibleTabs, type Tabs } from "./tabs";

const session = (id: string, project: string): SessionInfo => ({
  id,
  project,
  title: id,
  updated: 1,
  answering: false,
  agents: [],
});

const SESSIONS = [session("a", "p1"), session("b", "p1"), session("c", "p1"), session("d", "p1"), session("x", "p2")];

// Три вкладки первого проекта, активна вторая.
const THREE = openTab(openTab(openTab(openTab(NO_TABS, "p1", "a"), "p1", "b"), "p1", "c"), "p1", "b");

// Четыре вкладки, c и a закреплены именно в этом порядке: c a | b d.
const PINNED = pinTab(pinTab(openTab(THREE, "p1", "d"), "p1", "c", true), "p1", "a", true);

// Вкладки первого проекта слева направо, закреплённые с «^».
function strip(tabs: Tabs) {
  const { sessions, pinned } = visibleTabs(tabs, SESSIONS);

  return sessions.map((id) => `${"^".repeat(Number(pinned.includes(id)))}${id}`).join(" ");
}

describe("закрытие вкладки", () => {
  it.each([
    ["активной в середине: активна правая соседка", "b", "b", { sessions: ["a", "c"], active: "c", pinned: [] }],
    ["активной с краю: активна левая соседка", "c", "c", { sessions: ["a", "b"], active: "b", pinned: [] }],
    ["фоновой: активная та же", "b", "a", { sessions: ["b", "c"], active: "b", pinned: [] }],
  ])("%s", (_, active, closed, left) => {
    const tabs = closeTab(openTab(THREE, "p1", active), "p1", closed);

    expect(visibleTabs(tabs, SESSIONS)).toEqual(left);
  });

  it("вкладки другого проекта не трогает", () => {
    const tabs = closeTab(openTab(THREE, "p2", "x"), "p1", "a");

    expect(tabs.project).toBe("p2");
    expect(visibleTabs({ ...tabs, project: "p1" }, SESSIONS).sessions).toEqual(["b", "c"]);
  });

  it("закреплённая вкладка уходит и из закреплённых", () => {
    expect(strip(closeTab(PINNED, "p1", "c"))).toBe("^a b d");
  });
});

describe("закрепление", () => {
  it("закреплённые стоят левее остальных в порядке закрепления", () => {
    expect(strip(PINNED)).toBe("^c ^a b d");
  });

  it("открепленная встаёт первой среди остальных", () => {
    expect(strip(pinTab(PINNED, "p1", "c", false))).toBe("^a c b d");
  });

  it("новая вкладка открывается правее всех", () => {
    expect(strip(openTab(closeTab(PINNED, "p1", "d"), "p1", "d"))).toBe("^c ^a b d");
  });
});

describe("перестановка", () => {
  it.each([
    ["вперёд", "d", "b", "^c ^a d b"],
    ["в конец", "b", null, "^c ^a d b"],
    ["закреплённая среди закреплённых", "a", "c", "^a ^c b d"],
    ["обычная не заходит к закреплённым", "d", "c", "^c ^a d b"],
    ["закреплённая не уходит к обычным", "c", null, "^a ^c b d"],
    ["перед собой: на месте", "b", "b", "^c ^a b d"],
  ])("%s", (_, moved, before, picture) => {
    expect(strip(moveTab(PINNED, "p1", moved, before))).toBe(picture);
  });
});

describe("видимые вкладки", () => {
  it("удалённой сессии нет, активной становится последняя", () => {
    expect(visibleTabs(THREE, SESSIONS.filter((found) => found.id !== "b"))).toEqual({
      sessions: ["a", "c"],
      active: "c",
      pinned: [],
    });
  });

  it("без открытого проекта вкладок нет", () => {
    expect(visibleTabs(NO_TABS, SESSIONS)).toEqual({ sessions: [], active: null, pinned: [] });
  });
});

describe("вкладки из хранилища окна", () => {
  it.each([
    ["целые", PINNED, PINNED],
    ["вкладок не было", null, null],
    ["проекта нет", NO_TABS, NO_TABS],
    [
      "из версии без закрепления",
      { project: "p1", projects: { p1: { sessions: ["a"], active: "a" } } },
      { project: "p1", projects: { p1: { sessions: ["a"], active: "a", pinned: [] } } },
    ],
    [
      "закреплённые не слева и не все открыты",
      { project: "p1", projects: { p1: { sessions: ["a", "b"], active: "a", pinned: ["b", "z"] } } },
      { project: "p1", projects: { p1: { sessions: ["b", "a"], active: "a", pinned: ["b"] } } },
    ],
    ["проект не строкой", { project: 1, projects: {} }, null],
    ["без проектов", { project: "p1" }, null],
    ["сессии не списком", { project: "p1", projects: { p1: { sessions: "a", active: "a" } } }, null],
    ["сессия не строкой", { project: "p1", projects: { p1: { sessions: [1], active: null } } }, null],
    ["активная не строкой", { project: "p1", projects: { p1: { sessions: ["a"], active: 0 } } }, null],
    ["закреплённые не списком", { project: "p1", projects: { p1: { sessions: ["a"], active: null, pinned: "a" } } }, null],
  ])("%s", (_, stored, parsed) => {
    expect(parseTabs(stored)).toEqual(parsed);
  });
});
