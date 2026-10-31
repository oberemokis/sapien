import { describe, expect, it } from "vitest";
import {
  findNoteLink,
  fuzzyMatch,
  highlight,
  notesOf,
  parseRecent,
  pushRecent,
  searchNotes,
  type NoteItem,
} from "./search";

const item = (path: string): NoteItem => {
  const parts = path.replace(/\.md$/, "").split("/");
  const title = parts.pop() ?? path;

  return { path, title, folder: parts.join("/") };
};

describe("нечёткое совпадение", () => {
  it.each([
    ["прзнт", "Презентация"],
    ["ПЛАН", "план на ноябрь"],
    ["елка", "Ёлка"],
    ["ёлка", "елка"],
    ["", "что угодно"],
  ])("«%s» находит «%s»", (query, text) => {
    expect(fuzzyMatch(query, text)).not.toBeNull();
  });

  it.each([
    ["тнзп", "Презентация"],
    ["планы", "план"],
  ])("«%s» не находит «%s»", (query, text) => {
    expect(fuzzyMatch(query, text)).toBeNull();
  });

  it("совпавшие буквы указывают в исходное имя", () => {
    expect(fuzzyMatch("прзнт", "Презентация")?.hits).toEqual([0, 1, 3, 5, 6]);
    expect(highlight("Презентация", [0, 1, 3, 5, 6])).toEqual([
      { text: "Пр", hit: true, start: 0 },
      { text: "е", hit: false, start: 2 },
      { text: "з", hit: true, start: 3 },
      { text: "е", hit: false, start: 4 },
      { text: "нт", hit: true, start: 5 },
      { text: "ация", hit: false, start: 7 },
    ]);
  });
});

describe("поиск по заметкам", () => {
  const notes = [
    item("Архив/Сплав по реке.md"),
    item("Проекты/план.md"),
    item("Встречи/план.md"),
    item("План на ноябрь.md"),
  ];

  it("целое слово с начала выше разбросанных букв", () => {
    const titles = searchNotes(notes, "план").map((note) => note.path);

    expect(titles.slice(0, 2).toSorted()).toEqual(["Встречи/план.md", "Проекты/план.md"]);
    expect(titles[2]).toBe("План на ноябрь.md");
    expect(titles).not.toContain("Архив/Сплав по реке.md");
  });

  it("одинаковые имена различаются папкой", () => {
    const folders = searchNotes(notes, "план")
      .filter((note) => note.title === "план")
      .map((note) => note.folder);

    expect(folders.toSorted()).toEqual(["Встречи", "Проекты"]);
  });

  it("заметки собираются из всего дерева", () => {
    const tree = [
      {
        kind: "folder" as const,
        name: "Проекты",
        path: "Проекты",
        closed: false,
        children: [{ kind: "note" as const, name: "план.md", path: "Проекты/план.md" }],
      },
      { kind: "note" as const, name: "Идеи.md", path: "Идеи.md" },
    ];

    expect(notesOf(tree)).toEqual([item("Проекты/план.md"), item("Идеи.md")]);
  });
});

describe("[[ссылка]] на заметку", () => {
  const notes = ["Встречи/план.md", "Проекты/sapien/план.md", "План.md", "Идеи.md"].map(item);

  it("по имени без учёта регистра, ближе заметка из той же папки, потом с коротким путём", () => {
    expect(findNoteLink(notes, "идеи", "Встречи/Кофе.md")).toBe("Идеи.md");
    expect(findNoteLink(notes, "план", "Встречи/Кофе.md")).toBe("Встречи/план.md");
    expect(findNoteLink(notes, "план", "Идеи.md")).toBe("План.md");
  });

  it("по пути, с «.md» и с заголовком в конце", () => {
    expect(findNoteLink(notes, "Проекты/sapien/план", "Идеи.md")).toBe("Проекты/sapien/план.md");
    expect(findNoteLink(notes, "Идеи.md#Сегодня", "План.md")).toBe("Идеи.md");
  });

  it("нет такой заметки, null", () => {
    expect(findNoteLink(notes, "Нет", "Идеи.md")).toBeNull();
    expect(findNoteLink(notes, "#Заголовок", "Идеи.md")).toBeNull();
  });
});

describe("недавние", () => {
  it("свежий сверху, без повторов", () => {
    expect(pushRecent(["а.md", "б.md"], "б.md")).toEqual(["б.md", "а.md"]);
  });

  it("испорченный список из хранилища окна это пустой список", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent({ path: "а.md" })).toEqual([]);
    expect(parseRecent(["а.md", 1, "б.md"])).toEqual(["а.md", "б.md"]);
  });
});
