import { createStore } from "@tanstack/react-store";
import type { SessionOrder } from "../model/sessions";
import { NO_TABS, type Tabs } from "../model/tabs";

// Вкладки окна: у каждого проекта свой набор открытых сессий.
export const tabsStore = createStore<Tabs>(NO_TABS);

// Порядок сессий в левой панели, заданный перетаскиванием.
export const sessionOrderStore = createStore<SessionOrder>({});

// Сессии, у которых в левой панели свёрнута ветка агентов.
export const collapsedStore = createStore<string[]>([]);

// Открыт ли поиск сессии: его открывают ⌘K и кнопка в левой панели.
export const searchStore = createStore(false);
