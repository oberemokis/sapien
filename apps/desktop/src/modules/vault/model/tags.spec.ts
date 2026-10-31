import { describe, expect, it } from "vitest";
import { searchNotes, type NoteItem } from "./search";
import { notesWithTags, splitQuery, tagList, type NoteTags } from "./tags";

const notes: NoteTags[] = [
  { path: "Встречи/ретро.md", tags: ["Работа", "встреча"] },
  { path: "план.md", tags: ["работа/sapien", "работа/sapien"] },
  { path: "идеи.md", tags: [] },
];

const items: NoteItem[] = [
  { path: "Встречи/ретро.md", title: "ретро", folder: "Встречи" },
  { path: "план.md", title: "план", folder: "" },
  { path: "идеи.md", title: "идеи", folder: "" },
];

describe("теги хранилища", () => {
  it("по алфавиту, без учёта регистра, родитель считает вложенные", () => {
    expect(tagList(notes)).toEqual([
      { name: "встреча", count: 1 },
      { name: "Работа", count: 2 },
      { name: "работа/sapien", count: 1 },
    ]);
  });

  it("тег пропал из последней заметки и пропал из списка", () => {
    expect(tagList([{ path: "план.md", tags: [] }])).toEqual([]);
  });

  it("заметки со всеми тегами запроса, вложенные тоже", () => {
    expect(notesWithTags(notes, ["работа"])).toEqual(new Set(["Встречи/ретро.md", "план.md"]));
    expect(notesWithTags(notes, ["РАБОТА", "встреча"])).toEqual(new Set(["Встречи/ретро.md"]));
    expect(notesWithTags(notes, ["работа/sapien"])).toEqual(new Set(["план.md"]));
    expect(notesWithTags(notes, ["отпуск"])).toEqual(new Set());
  });

  it("запрос делится на теги и имя", () => {
    expect(splitQuery(" #работа план  #встреча ")).toEqual({ tags: ["работа", "встреча"], name: "план" });
    expect(splitQuery("#")).toEqual({ tags: [], name: "" });
  });

  it("поиск по тегу: по алфавиту, с именем сужается, чужого тега нет", () => {
    expect(searchNotes(items, "#работа", notes).map((note) => note.title)).toEqual(["план", "ретро"]);
    expect(searchNotes(items, "#работа рет", notes).map((note) => note.title)).toEqual(["ретро"]);
    expect(searchNotes(items, "#отпуск", notes)).toEqual([]);
  });
});
