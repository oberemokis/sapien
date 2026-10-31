import { appStorage } from "@/core/storage/app-storage";
import { DEFAULT_TRACKED, EMPTY_INBOX, type Inbox } from "../model/inbox";

const INBOX_KEY = "sapien.youtrack.inbox";
const TRACKED_KEY = "sapien.youtrack.tracked";

// Лента несёт текст комментариев, поэтому лежит в хранилище приложения,
// зашифрованной. Испорченная или пропавшая начинается заново с недели
// назад, а приложение не падает.
export function readInbox(): Inbox {
  try {
    const inbox: Partial<Inbox> | null = JSON.parse(appStorage.getItem(INBOX_KEY) ?? "null");

    return { polled: inbox?.polled ?? null, events: inbox?.events ?? [], read: inbox?.read ?? [] };
  } catch {
    return EMPTY_INBOX;
  }
}

export function writeInbox(inbox: Inbox) {
  appStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
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
