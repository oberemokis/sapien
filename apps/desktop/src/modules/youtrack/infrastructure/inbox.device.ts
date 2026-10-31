import { DEFAULT_TRACKED, EMPTY_INBOX, type Inbox } from "../model/inbox";

const INBOX_KEY = "sapien.youtrack.inbox";
const TRACKED_KEY = "sapien.youtrack.tracked";

// Хранилище окна бывает закрыто политикой или испорчено: тогда лента
// начинается заново с недели назад, а приложение не падает.
export function readInbox(): Inbox {
  try {
    const inbox: Partial<Inbox> | null = JSON.parse(localStorage.getItem(INBOX_KEY) ?? "null");

    return { polled: inbox?.polled ?? null, events: inbox?.events ?? [], read: inbox?.read ?? [] };
  } catch {
    return EMPTY_INBOX;
  }
}

export function writeInbox(inbox: Inbox) {
  try {
    localStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
  } catch {
    // Лента уже в окне, без записи она только не переживёт перезапуск.
  }
}

// Запрос отслеживаемых задач из настроек.
export function readTracked() {
  try {
    return localStorage.getItem(TRACKED_KEY) ?? DEFAULT_TRACKED;
  } catch {
    return DEFAULT_TRACKED;
  }
}

export function writeTracked(query: string) {
  try {
    localStorage.setItem(TRACKED_KEY, query);
  } catch {
    // Запрос уже действует, без записи он не переживёт перезапуск.
  }
}
