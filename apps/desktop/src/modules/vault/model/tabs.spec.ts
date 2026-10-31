import { describe, expect, it } from "vitest";
import { closeTab, cycleTab, keepTabs, moveTab, NO_TABS, openTab, parseTabs, tabLabels } from "./tabs";

const three = { tabs: ["а.md", "б.md", "в.md"], active: "б.md" };

describe("вкладки", () => {
  it("клик заменяет файл активной вкладки, ⌘клик открывает новую справа", () => {
    expect(openTab(three, "г.md", false)).toEqual({ tabs: ["а.md", "г.md", "в.md"], active: "г.md" });
    expect(openTab(three, "г.md", true)).toEqual({ tabs: ["а.md", "б.md", "г.md", "в.md"], active: "г.md" });
  });

  it("открытый файл не открывается второй раз, его вкладка становится активной", () => {
    expect(openTab(three, "в.md", true)).toEqual({ ...three, active: "в.md" });
  });

  it("без вкладок файл открывается в новой", () => {
    expect(openTab(NO_TABS, "а.md", false)).toEqual({ tabs: ["а.md"], active: "а.md" });
  });

  it("закрыли активную: на экран соседняя справа, у края слева, последнюю ничем", () => {
    expect(closeTab(three, "б.md")).toEqual({ tabs: ["а.md", "в.md"], active: "в.md" });
    expect(closeTab({ ...three, active: "в.md" }, "в.md")).toEqual({ tabs: ["а.md", "б.md"], active: "б.md" });
    expect(closeTab(three, "а.md")).toEqual({ tabs: ["б.md", "в.md"], active: "б.md" });
    expect(closeTab({ tabs: ["а.md"], active: "а.md" }, "а.md")).toEqual(NO_TABS);
  });

  it("Ctrl+Tab ходит по кругу", () => {
    expect(cycleTab({ ...three, active: "в.md" }, 1).active).toBe("а.md");
    expect(cycleTab({ ...three, active: "а.md" }, -1).active).toBe("в.md");
  });

  it("перетаскивание ставит вкладку на новое место", () => {
    expect(moveTab(three, "а.md", 2).tabs).toEqual(["б.md", "в.md", "а.md"]);
    expect(moveTab(three, "в.md", 0).tabs).toEqual(["в.md", "а.md", "б.md"]);
  });

  it("при запуске вкладки пропавших файлов не восстанавливаются", () => {
    expect(keepTabs(three, (path) => path !== "б.md")).toEqual({ tabs: ["а.md", "в.md"], active: "а.md" });
  });

  it("испорченный набор из хранилища окна это пустой набор", () => {
    expect(parseTabs(null)).toEqual(NO_TABS);
    expect(parseTabs({ tabs: "а.md" })).toEqual(NO_TABS);
    expect(parseTabs({ tabs: ["а.md", 1, "а.md"], active: "нет.md" })).toEqual({ tabs: ["а.md"], active: "а.md" });
  });

  it("одинаковые имена подписаны папкой", () => {
    expect(tabLabels(["Проекты/план.md", "Встречи/план.md", "идеи.md"])).toEqual([
      { path: "Проекты/план.md", title: "план", folder: "Проекты" },
      { path: "Встречи/план.md", title: "план", folder: "Встречи" },
      { path: "идеи.md", title: "идеи", folder: "" },
    ]);
  });
});
