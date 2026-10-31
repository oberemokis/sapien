import { describe, expect, it } from "vitest";
import {
  checkName,
  childrenOf,
  foldersDownTo,
  isClosedToAgent,
  isWithin,
  movedPath,
  parentOf,
  suggestName,
  type VaultEntry,
} from "./vault";

const note = (path: string): VaultEntry => ({ kind: "note", name: path.split("/").at(-1) ?? path, path });
const folder = (path: string, children: VaultEntry[] = [], closed = false): VaultEntry => ({
  kind: "folder",
  name: path.split("/").at(-1) ?? path,
  path,
  children,
  closed,
});

describe("папка, закрытая для агента", () => {
  const tree = [
    folder("Личное", [folder("Личное/Здоровье", [note("Личное/Здоровье/анализы.md")])], true),
    folder("Личное 2", [note("Личное 2/план.md")]),
    note("план.md"),
  ];

  it.each([
    ["Личное/дневник.md", true],
    ["Личное/Здоровье/анализы.md", true],
    ["Личное 2/план.md", false],
    ["план.md", false],
  ])("%s", (path, closed) => {
    expect(isClosedToAgent(tree, path)).toBe(closed);
  });
});

describe("имя нового элемента", () => {
  it.each([
    ["", "name_empty"],
    ["   ", "name_empty"],
    ["а/б", "name_forbidden"],
    ["итоги: октябрь", "name_forbidden"],
    ['цитата "так"', "name_forbidden"],
    ["строка\nвторая", "name_forbidden"],
    [".скрытое", "name_hidden"],
    ["Встреча 31.10", null],
  ] as const)("«%s» даёт %s", (name, problem) => {
    expect(checkName(name, "note", [])).toBe(problem);
  });

  it("занятость без учёта регистра и с учётом .md", () => {
    const siblings = [note("План.md"), folder("Архив")];

    expect(checkName("план", "note", siblings)).toBe("name_taken");
    expect(checkName("план.md", "note", siblings)).toBe("name_taken");
    expect(checkName("архив", "folder", siblings)).toBe("name_taken");
    // Папка «План» и заметка «План.md» на диске не мешают друг другу.
    expect(checkName("План", "folder", siblings)).toBeNull();
    expect(checkName("Архив", "note", siblings)).toBeNull();
  });

  it("свободное имя предлагается с номером", () => {
    const siblings = [note("Без названия.md"), note("Без названия 1.md")];

    expect(suggestName("Без названия", "note", [])).toBe("Без названия");
    expect(suggestName("Без названия", "note", siblings)).toBe("Без названия 2");
    expect(suggestName("Без названия", "folder", siblings)).toBe("Без названия");
  });
});

describe("пути дерева", () => {
  const tree = [folder("Проекты", [folder("Проекты/sapien", [note("Проекты/sapien/план.md")])]), note("Идеи.md")];

  it("содержимое папки по пути", () => {
    expect(childrenOf(tree, "")).toBe(tree);
    expect(childrenOf(tree, "Проекты/sapien")).toEqual([note("Проекты/sapien/план.md")]);
    expect(childrenOf(tree, "Нет")).toEqual([]);
  });

  it("родитель и цепочка папок", () => {
    expect(parentOf("Проекты/sapien/план.md")).toBe("Проекты/sapien");
    expect(parentOf("Идеи.md")).toBe("");
    expect(foldersDownTo("Проекты/sapien")).toEqual(["Проекты", "Проекты/sapien"]);
    expect(foldersDownTo("")).toEqual([]);
  });

  it("внутри папки только её содержимое, а не соседи с тем же началом имени", () => {
    expect(isWithin("Проекты/sapien/план.md", "Проекты")).toBe(true);
    expect(isWithin("Проекты", "Проекты")).toBe(true);
    expect(isWithin("Проекты 2/план.md", "Проекты")).toBe(false);
    expect(isWithin("Проекты.md", "Проекты")).toBe(false);
  });

  it("путь после переименований снаружи, по порядку и вместе с папкой", () => {
    const moved = [
      { from: "Проекты", to: "Архив/Проекты" },
      { from: "Архив/Проекты/sapien/план.md", to: "Архив/Проекты/sapien/итоги.md" },
    ];

    expect(movedPath("Проекты/sapien/план.md", moved)).toBe("Архив/Проекты/sapien/итоги.md");
    expect(movedPath("Проекты/доклад.md", moved)).toBe("Архив/Проекты/доклад.md");
    expect(movedPath("Проекты", moved)).toBe("Архив/Проекты");
    expect(movedPath("Проекты 2/план.md", moved)).toBe("Проекты 2/план.md");
  });
});
