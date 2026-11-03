import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./sessions";
import { closeTab, NO_TABS, openTab, parseTabs, visibleTabs } from "./tabs";

const session = (id: string, project: string): SessionInfo => ({
  id,
  project,
  title: id,
  updated: 1,
  answering: false,
  agents: [],
});

const SESSIONS = [session("a", "p1"), session("b", "p1"), session("c", "p1"), session("x", "p2")];

// Три вкладки первого проекта, активна вторая.
const THREE = openTab(openTab(openTab(openTab(NO_TABS, "p1", "a"), "p1", "b"), "p1", "c"), "p1", "b");

describe("закрытие вкладки", () => {
  it.each([
    ["активной в середине: активна правая соседка", "b", "b", { sessions: ["a", "c"], active: "c" }],
    ["активной с краю: активна левая соседка", "c", "c", { sessions: ["a", "b"], active: "b" }],
    ["фоновой: активная та же", "b", "a", { sessions: ["b", "c"], active: "b" }],
  ])("%s", (_, active, closed, left) => {
    const tabs = closeTab(openTab(THREE, "p1", active), "p1", closed);

    expect(visibleTabs(tabs, SESSIONS)).toEqual(left);
  });

  it("вкладки другого проекта не трогает", () => {
    const tabs = closeTab(openTab(THREE, "p2", "x"), "p1", "a");

    expect(tabs.project).toBe("p2");
    expect(visibleTabs({ ...tabs, project: "p1" }, SESSIONS).sessions).toEqual(["b", "c"]);
  });
});

describe("видимые вкладки", () => {
  it("удалённой сессии нет, активной становится последняя", () => {
    expect(visibleTabs(THREE, SESSIONS.filter((found) => found.id !== "b"))).toEqual({ sessions: ["a", "c"], active: "c" });
  });

  it("без открытого проекта вкладок нет", () => {
    expect(visibleTabs(NO_TABS, SESSIONS)).toEqual({ sessions: [], active: null });
  });
});

describe("вкладки из хранилища окна", () => {
  it.each([
    ["целые", THREE, THREE],
    ["вкладок не было", null, null],
    ["проекта нет", NO_TABS, NO_TABS],
    ["проект не строкой", { project: 1, projects: {} }, null],
    ["без проектов", { project: "p1" }, null],
    ["сессии не списком", { project: "p1", projects: { p1: { sessions: "a", active: "a" } } }, null],
    ["сессия не строкой", { project: "p1", projects: { p1: { sessions: [1], active: null } } }, null],
    ["активная не строкой", { project: "p1", projects: { p1: { sessions: ["a"], active: 0 } } }, null],
  ])("%s", (_, stored, parsed) => {
    expect(parseTabs(stored)).toEqual(parsed);
  });
});
