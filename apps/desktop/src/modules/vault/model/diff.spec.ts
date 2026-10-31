import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

// Строка сравнения коротко: пробел общая, «-» только в первом, «+» только во втором.
function short(before: string, after: string) {
  const marks = { same: " ", removed: "-", added: "+" };

  return diffLines(before, after).map((line) => `${marks[line.kind]}${line.text}`);
}

describe("сравнение строк", () => {
  it.each([
    ["одинаковые тексты", "а\nб", "а\nб", [" а", " б"]],
    ["правка строки посередине", "а\nб\nв", "а\nБ\nв", [" а", "-б", "+Б", " в"]],
    ["вставка строки", "а\nв", "а\nб\nв", [" а", "+б", " в"]],
    ["удаление строки", "а\nб\nв", "а\nв", [" а", "-б", " в"]],
    ["пустой текст против текста", "", "а\nб", ["+а", "+б"]],
    ["текст против пустого", "а", "", ["-а"]],
    ["перестановка находит общую строку", "а\nб\nв", "в\nа\nб", ["+в", " а", " б", "-в"]],
  ])("%s", (_, before, after, expected) => {
    expect(short(before, after)).toEqual(expected);
  });

  it("огромная середина не строит таблицу, а показывает убранное и добавленное", () => {
    const before = Array.from({ length: 1100 }, (_, index) => `было ${index}`).join("\n");
    const after = Array.from({ length: 1100 }, (_, index) => `стало ${index}`).join("\n");
    const lines = diffLines(before, after);

    expect(lines).toHaveLength(2200);
    expect(lines[0]).toEqual({ kind: "removed", text: "было 0" });
    expect(lines[1100]).toEqual({ kind: "added", text: "стало 0" });
  });
});
