import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, useSyncExternalStore } from "react";
import { agentClear, agentHistory, agentSend, agentStop } from "../infrastructure/agent.api";
import { isOnline, subscribeOnline } from "../infrastructure/agent.device";
import { applyEvent, chatProblemOf, type ChatContext, type ChatEntry, type ChatProblem } from "../model/chat";

const HISTORY_KEY = ["agent", "history"] as const;

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, isOnline);
}

// Чат хранилища: сохранённая история и ответ, который идёт сейчас. Пока
// ответ идёт, его строки живут здесь, а после него история читается
// заново из Rust: там уже всё, что дошло.
export function useChat() {
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: HISTORY_KEY, queryFn: agentHistory });
  const [live, setLive] = useState<ChatEntry[] | null>(null);
  const [problem, setProblem] = useState<ChatProblem | null>(null);

  const send = useCallback(
    async (model: string, text: string, context: ChatContext) => {
      const asked: ChatEntry[] = [];

      if (text.trim() !== "") {
        asked.push({ kind: "user", text });
      }

      setProblem(null);
      setLive(asked);

      try {
        await agentSend(model, text, context, (event) => setLive((entries) => applyEvent(entries ?? [], event)));
      } catch (error) {
        setProblem(chatProblemOf(error));
      }

      await queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      setLive(null);
    },
    [queryClient],
  );

  const clear = useCallback(async () => {
    setProblem(null);

    try {
      await agentClear();
    } catch (error) {
      setProblem(chatProblemOf(error));
    }

    await queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
  }, [queryClient]);

  // Строки только дописываются в конец, поэтому номер строки годится ей
  // в ключ: после конца ответа строки истории встают на те же номера.
  const entries = [...(history.data ?? []), ...(live ?? [])].map((entry, id) => ({ id, entry }));

  return {
    entries,
    loaded: history.data !== undefined,
    running: live !== null,
    problem,
    send,
    stop: agentStop,
    clear,
  };
}
