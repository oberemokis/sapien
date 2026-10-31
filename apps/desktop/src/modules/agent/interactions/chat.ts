import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback } from "react";
import { agentClear, agentHistory, agentSend, agentStop, agentUndo } from "../infrastructure/agent.api";
import { applyEvent, chatProblemOf, type ChatContext, type ChatEntry, type ChatProblem } from "../model/chat";
import { chatStore } from "../store/chat.store";

const HISTORY_KEY = ["agent", "history"] as const;

// «Откатить» у ответа на сообщение с этим номером. Заметки после отката
// дерево и редактор узнают сами: Rust шлёт событие об изменении хранилища.
export function useUndo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentUndo,
    onSettled: () => queryClient.invalidateQueries({ queryKey: HISTORY_KEY }),
  });
}

export { useOnline } from "@/core/network/online";

// Причина, почему работа не началась, без запроса к Rust: например,
// действию нужна интеграция, которой нет. null убирает причину.
export function reportProblem(problem: ChatProblem | null) {
  chatStore.setState((state) => ({ ...state, problem }));
}

// Сообщение агенту. Пока ответ идёт, его строки живут в chatStore, а после
// него история читается заново из Rust: там уже всё, что дошло. Второе
// сообщение, пока идёт первое, не уходит.
export function useSend() {
  const queryClient = useQueryClient();

  return useCallback(
    async (model: string, text: string, context: ChatContext) => {
      if (chatStore.get().live !== null) {
        return;
      }

      const asked: ChatEntry[] = [];

      if (text.trim() !== "") {
        asked.push({ kind: "user", text });
      }

      chatStore.setState(() => ({ live: asked, problem: null }));

      try {
        await agentSend(model, text, context, (event) =>
          chatStore.setState((state) => ({ ...state, live: applyEvent(state.live ?? [], event) })),
        );
      } catch (error) {
        reportProblem(chatProblemOf(error));
      }

      await queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
      chatStore.setState((state) => ({ ...state, live: null }));
    },
    [queryClient],
  );
}

// Чат хранилища: сохранённая история и ответ, который идёт сейчас.
export function useChat() {
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: HISTORY_KEY, queryFn: agentHistory });
  const { live, problem } = useSelector(chatStore);
  const send = useSend();

  const clear = useCallback(async () => {
    reportProblem(null);

    try {
      await agentClear();
    } catch (error) {
      reportProblem(chatProblemOf(error));
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
