import { createStore } from "@tanstack/react-store";
import type { ChatEntry, ChatProblem } from "../model/chat";

// Ответ, который идёт сейчас, почему последний не дошёл, вопрос, который
// ждёт человека, и спрашивать ли разрешения на правки до конца разговора.
// Живёт здесь, а не в панели: действие запускают и при закрытой панели чата.
export const chatStore = createStore<{
  live: ChatEntry[] | null;
  problem: ChatProblem | null;
  open: string | null;
  askEdits: boolean;
}>({
  live: null,
  problem: null,
  open: null,
  askEdits: true,
});
