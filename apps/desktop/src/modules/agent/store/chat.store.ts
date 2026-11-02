import { createStore } from "@tanstack/react-store";
import type { ChatEntry, ChatProblem } from "../model/chat";

// Ответ, который идёт сейчас, и сессия, к которой он относится, почему
// последний ответ сессии не дошёл, вопрос, который ждёт человека,
// и спрашивать ли разрешения на инструменты. Ответ в приложении один
// на все сессии. Живёт здесь, а не в чате: действие запускают и с другого
// экрана.
export const chatStore = createStore<{
  session: string | null;
  live: ChatEntry[] | null;
  problem: { session: string; code: ChatProblem } | null;
  open: string | null;
  askEdits: boolean;
}>({
  session: null,
  live: null,
  problem: null,
  open: null,
  askEdits: true,
});

// Сессия, открытая в чате. null: ни одной не выбрано.
export const sessionStore = createStore<string | null>(null);

// Открыт ли поиск сессии: его открывают ⌘K и кнопка в левой панели.
export const searchStore = createStore(false);
