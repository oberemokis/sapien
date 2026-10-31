import { parseDraft } from "./draft";
import type { FeedEvent } from "./youtrack";

// Лента на устройстве: когда YouTrack спрашивали последний раз, события
// и номера прочитанных.
export type Inbox = { polled: number | null; events: FeedEvent[]; read: string[] };

export const EMPTY_INBOX: Inbox = { polled: null, events: [], read: [] };

// Событий в ленте не больше этого: старые уходят.
const LIMIT = 300;

// Отслеживаемые задачи по умолчанию: свои, заведённые и те, где писал.
export const DEFAULT_TRACKED = "for: me or reported by: me or commenter: me";

// Первый опрос смотрит на неделю назад.
export const FIRST_LOOK = 7 * 24 * 60 * 60 * 1000;

// Новые события к прежним. Повтор по номеру не добавляется: то же событие
// приходит снова, когда опросы перекрываются. Свежие сверху.
export function mergeEvents(known: FeedEvent[], fresh: FeedEvent[]) {
  const ids = new Set(known.map((event) => event.id));
  const added = fresh.filter((event) => !ids.has(event.id));

  return [...known, ...added].toSorted((a, b) => b.at - a.at).slice(0, LIMIT);
}

// Прочитанные среди тех, что ещё в ленте: ушедшее из ленты забывается.
export function keepRead(events: FeedEvent[], read: string[]) {
  const ids = new Set(events.map((event) => event.id));

  return read.filter((id) => ids.has(id));
}

export function unreadCount({ events, read }: Inbox) {
  const seen = new Set(read);

  return events.filter((event) => !seen.has(event.id)).length;
}

// Фильтр сверху ленты: по номеру, названию, проекту и тексту события.
export function filterEvents(events: FeedEvent[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  return events.filter((event) => {
    const text = [event.issue, event.summary, event.project, event.detail ?? "", event.author ?? ""]
      .join(" ")
      .toLowerCase();

    return words.every((word) => text.includes(word));
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNITS = [
  { unit: "year", size: 365 * DAY },
  { unit: "month", size: 30 * DAY },
  { unit: "week", size: 7 * DAY },
  { unit: "day", size: DAY },
  { unit: "hour", size: HOUR },
] as const;

// Сколько прошло с at до now в самой крупной подходящей единице, для
// Intl.RelativeTimeFormat: -5 «hour» это «5 часов назад».
export function ago(at: number, now: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const passed = Math.max(0, now - at);
  const found = UNITS.find(({ size }) => passed >= size);

  if (found === undefined) {
    return { value: -Math.floor(passed / MINUTE), unit: "minute" };
  }

  return { value: -Math.floor(passed / found.size), unit: found.unit };
}

// Номера задач из шапок черновиков хранилища: опубликованное из заметок
// отслеживается всегда, даже если запрос его не находит.
export function draftIds(notes: { text: string }[]) {
  const ids = notes.flatMap(({ text }) => parseDraft(text, "")?.id ?? []);

  return [...new Set(ids)].toSorted();
}
