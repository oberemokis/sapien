import { createStore } from "@tanstack/react-store";
import { DEFAULT_TRACKED, EMPTY_INBOX, type Inbox } from "../model/inbox";

// Лента «Входящих»: события, прочитанное и время последнего опроса.
export const inboxStore = createStore<Inbox>(EMPTY_INBOX);

// Запрос YouTrack, по которому задачи попадают в ленту.
export const trackedStore = createStore(DEFAULT_TRACKED);
