import { createStore } from "@tanstack/react-store";
import type { Panes } from "../model/panes";

// Панели по сессиям. Сессия без записи это одна панель.
export const panesStore = createStore<Record<string, Panes>>({});

// Что случилось с оболочкой панели: кончилась или не запустилась.
export type TerminalNotice = "exited" | "failed";

// Терминалы по панелям. generation растёт, когда терминал начинают
// заново: панель открывает его по новой.
export type TerminalState = { notice: TerminalNotice | null; generation: number };

export const terminalsStore = createStore<Record<string, TerminalState>>({});
