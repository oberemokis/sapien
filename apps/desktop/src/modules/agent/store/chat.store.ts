import { createStore } from "@tanstack/react-store";
import type { ChatEntry, ChatProblem } from "../model/chat";

// Ответ, который идёт сейчас, и почему последний не дошёл. Живёт здесь,
// а не в панели: действие запускают и при закрытой панели чата.
export const chatStore = createStore<{ live: ChatEntry[] | null; problem: ChatProblem | null }>({
  live: null,
  problem: null,
});
