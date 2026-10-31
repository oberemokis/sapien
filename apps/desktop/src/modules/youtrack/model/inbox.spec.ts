import { describe, expect, it } from "vitest";
import { ago, draftIds, filterEvents, keepRead, mergeEvents, unreadCount } from "./inbox";
import type { FeedEvent } from "./youtrack";

const HOUR = 3_600_000;

function event(id: string, at: number, extra: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id,
    kind: "comment",
    issue: "SAP-1",
    summary: "Вход по ссылке",
    project: "SAP",
    at,
    author: "Анна",
    detail: "Посмотри макет",
    ...extra,
  };
}

describe("лента входящих", () => {
  it("повтор события из перекрытого опроса не добавляется, свежие сверху", () => {
    const known = [event("a2", 2 * HOUR), event("a1", HOUR)];
    const merged = mergeEvents(known, [event("a3", 3 * HOUR), event("a2", 2 * HOUR)]);

    expect(merged.map(({ id }) => id)).toEqual(["a3", "a2", "a1"]);
  });

  it("лента держит не больше трёхсот событий, уходят старые", () => {
    const fresh = Array.from({ length: 305 }, (_, index) => event(`e${index}`, index * HOUR));
    const merged = mergeEvents([], fresh);

    expect(merged).toHaveLength(300);
    expect(merged.at(-1)?.id).toBe("e5");
  });

  it("прочитанное, ушедшее из ленты, забывается, а непрочитанное считается", () => {
    const events = [event("a1", HOUR), event("a2", 2 * HOUR)];
    const read = keepRead(events, ["a1", "old"]);

    expect(read).toEqual(["a1"]);
    expect(unreadCount({ polled: null, events, read })).toBe(1);
  });

  it("фильтр ищет все слова в номере, названии, проекте, авторе и тексте", () => {
    const events = [
      event("a1", HOUR),
      event("a2", HOUR, { issue: "WEB-4", summary: "Тёмная тема", project: "WEB", author: null, detail: "Open → Done" }),
    ];

    expect(filterEvents(events, "web done").map(({ id }) => id)).toEqual(["a2"]);
    expect(filterEvents(events, "анна МАКЕТ").map(({ id }) => id)).toEqual(["a1"]);
    expect(filterEvents(events, "  ")).toHaveLength(2);
  });

  it("номера берутся только из опубликованных черновиков, без повторов", () => {
    const notes = [
      { text: "---\nproject: SAP\nyoutrack: SAP-7\n---\n# Вход" },
      { text: "---\nproject: SAP\nyoutrack: SAP-7\n---\n# Копия" },
      { text: "---\nproject: SAP\n---\n# Ещё не опубликован" },
      { text: "---\nyoutrack: SAP-9\n---\nне черновик" },
      { text: "---\nproject: WEB\nyoutrack: WEB-2\n---\n" },
    ];

    expect(draftIds(notes)).toEqual(["SAP-7", "WEB-2"]);
  });

  it("время события в самой крупной подходящей единице", () => {
    const now = 1000 * 24 * HOUR;

    expect(ago(now - 30_000, now)).toEqual({ value: -0, unit: "minute" });
    expect(ago(now - 5 * 60_000, now)).toEqual({ value: -5, unit: "minute" });
    expect(ago(now - 5 * HOUR, now)).toEqual({ value: -5, unit: "hour" });
    expect(ago(now - 30 * HOUR, now)).toEqual({ value: -1, unit: "day" });
    expect(ago(now - 15 * 24 * HOUR, now)).toEqual({ value: -2, unit: "week" });
    expect(ago(now + HOUR, now)).toEqual({ value: -0, unit: "minute" });
  });
});
