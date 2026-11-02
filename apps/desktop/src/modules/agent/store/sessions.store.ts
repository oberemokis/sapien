import { createStore } from "@tanstack/react-store";
import { NO_TABS, type Tabs } from "../model/tabs";

// Вкладки окна: у каждого проекта свой набор открытых сессий.
export const tabsStore = createStore<Tabs>(NO_TABS);

// Открыт ли поиск сессии: его открывают ⌘K и кнопка в левой панели.
export const searchStore = createStore(false);
