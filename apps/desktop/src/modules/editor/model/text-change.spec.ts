import { describe, expect, it } from "vitest";
import { textChange } from "./text-change";

function apply(before: string, change: ReturnType<typeof textChange>) {
  return before.slice(0, change.from) + change.insert + before.slice(change.to);
}

describe("замена текста снаружи", () => {
  it.each([
    ["дописали в конец", "план", "план и итоги"],
    ["вставили в середину", "раз три", "раз два три"],
    ["стёрли всё", "план", ""],
    ["было пусто", "", "план"],
    ["повтор букв на стыке", "aaa", "aaaa"],
    ["одинаково", "план", "план"],
  ])("%s", (_, before, after) => {
    expect(apply(before, textChange(before, after))).toBe(after);
  });

  it("меняет только середину, начало и конец на месте", () => {
    expect(textChange("# План\nстарое\nконец", "# План\nновое\nконец")).toEqual({
      from: 7,
      to: 11,
      insert: "нов",
    });
  });
});
