import { createStore } from "@tanstack/react-store";
import type { Choice } from "../model/agents";

// Выбор агента, модели и размышления. last: последний выбор окна, с ним
// начинается новая сессия. sessions: выбранное в сессии, пока оно не ушло
// с сообщением, дальше выбор помнит сама сессия в Rust.
export const choiceStore = createStore<{ last: Choice | null; sessions: Record<string, Choice> }>({
  last: null,
  sessions: {},
});
