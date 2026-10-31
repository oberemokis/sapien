import { describe, expect, it } from "vitest";
import { checkName, childrenOf, foldersDownTo, parentOf, suggestName, type VaultEntry } from "./vault";

const note = (path: string): VaultEntry => ({ kind: "note", name: path.split("/").at(-1) ?? path, path });
const folder = (path: string, children: VaultEntry[] = []): VaultEntry => ({
  kind: "folder",
  name: path.split("/").at(-1) ?? path,
  path,
  children,
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
});
