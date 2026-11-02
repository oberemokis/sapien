import { createStore } from "@tanstack/react-store";
import type { Choice } from "../model/agents";

// Выбор агента, модели и размышления. last: последний выбор окна, с ним
// начинается новая сессия. sessions: выбранное в каждой сессии до закрытия
// окна. Оно важнее того, с чем сессия ответила в Rust, а после отправки
// с ним совпадает.
export const choiceStore = createStore<{ last: Choice | null; sessions: Record<string, Choice> }>({
  last: null,
  sessions: {},
});
