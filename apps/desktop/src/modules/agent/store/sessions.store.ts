import { createStore } from "@tanstack/react-store";
import type { Panes } from "../model/panes";
import { NO_TABS, type Tabs } from "../model/tabs";

// Вкладки окна: у каждого проекта свой набор открытых сессий.
export const tabsStore = createStore<Tabs>(NO_TABS);

// Панели по сессиям. Сессия без записи это одна панель.
export const panesStore = createStore<Record<string, Panes>>({});

// Открыт ли поиск сессии: его открывают ⌘K и кнопка в левой панели.
export const searchStore = createStore(false);

// Что случилось с оболочкой панели: кончилась или не запустилась.
export type TerminalNotice = "exited" | "failed";

// Терминалы по панелям. generation растёт, когда терминал начинают
// заново: панель открывает его по новой.
export type TerminalState = { notice: TerminalNotice | null; generation: number };

export const terminalsStore = createStore<Record<string, TerminalState>>({});
