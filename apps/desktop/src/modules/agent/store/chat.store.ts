import { createStore } from "@tanstack/react-store";
import type { ChatEntry, ChatProblem } from "../model/chat";
import { NO_TABS, type Tabs } from "../model/tabs";

// Ответ, который идёт сейчас: его строки и вопрос, который ждёт человека.
export type LiveRun = { entries: ChatEntry[]; open: string | null };

// Ответы, которые идут сейчас, по сессиям: ответы разных сессий идут
// параллельно. problems: почему последний ответ сессии не дошёл. askEdits:
// спрашивать ли разрешения на инструменты. Живёт здесь, а не в чате:
// действие запускают и с другого экрана, а ответ идёт и в закрытой вкладке.
export const chatStore = createStore<{
  runs: Record<string, LiveRun>;
  problems: Record<string, ChatProblem>;
  askEdits: boolean;
}>({
  runs: {},
  problems: {},
  askEdits: true,
});

// Вкладки окна: у каждого проекта свой набор открытых сессий.
export const tabsStore = createStore<Tabs>(NO_TABS);

// Недописанное сообщение каждой сессии: вкладка переключается или
// закрывается, а черновик ждёт её до закрытия окна.
export const draftStore = createStore<Record<string, string>>({});

// Открыт ли поиск сессии: его открывают ⌘K и кнопка в левой панели.
export const searchStore = createStore(false);
