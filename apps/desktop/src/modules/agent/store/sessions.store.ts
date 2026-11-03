import { createStore } from "@tanstack/react-store";
import { NO_TABS, type Tabs } from "../model/tabs";

// Вкладки окна: у каждого проекта свой набор открытых сессий.
export const tabsStore = createStore<Tabs>(NO_TABS);

// Открыт ли поиск сессии: его открывают ⌘K и кнопка в левой панели.
export const searchStore = createStore(false);

// Что случилось с оболочкой сессии: кончилась или не запустилась.
export type TerminalNotice = "exited" | "failed";

// Терминалы по сессиям. generation растёт, когда терминал начинают
// заново: вкладка открывает его по новой.
export type TerminalState = { notice: TerminalNotice | null; generation: number };

export const terminalsStore = createStore<Record<string, TerminalState>>({});
