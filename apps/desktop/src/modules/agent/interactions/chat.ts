import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect } from "react";
import {
  agentAnswer,
  agentAttach,
  agentClaudeSession,
  agentClear,
  agentHistory,
  agentSend,
  agentStop,
  agentUndo,
} from "../infrastructure/agent.api";
import {
  applyEvent,
  chatProblemOf,
  isNoted,
  type Answer,
  type ChatContext,
  type ChatEntry,
  type ChatEvent,
  type ChatProblem,
  type Oversight,
} from "../model/chat";
import type { AgentMethod } from "../model/method";
import { chatStore } from "../store/chat.store";
import { modelStore } from "../store/model.store";
import { currentMethod, useAgentMethod } from "./method";

// История у каждого способа своя. Ключ ответа заканчивается способом,
// а конец ответа перечитывает все истории сразу.
const HISTORY_KEY = ["agent", "history"] as const;

function historyKey(method: AgentMethod) {
  return [...HISTORY_KEY, method] as const;
}

// Событие идущего ответа: его строки и вопрос, который ждёт человека.
function receive(event: ChatEvent) {
  chatStore.setState((state) => {
    let open = state.open;

    if (event.kind === "asked") {
      open = event.question.id;
    }

    if (event.kind === "answered" && event.id === open) {
      open = null;
    }

    return { ...state, live: applyEvent(state.live ?? [], event), open };
  });
}

// Ответ кончился: история читается заново из Rust, там уже всё, что дошло.
async function finish(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
  chatStore.setState((state) => ({ ...state, live: null, open: null }));
}

// «Откатить» у ответа на сообщение с этим номером. Заметки после отката
// дерево и редактор узнают сами: Rust шлёт событие об изменении хранилища.
export function useUndo() {
  const queryClient = useQueryClient();
  const method = useAgentMethod();

  return useMutation({
    mutationFn: (turn: number) => agentUndo(method, turn),
    onSettled: () => queryClient.invalidateQueries({ queryKey: HISTORY_KEY }),
  });
}

export { useOnline } from "@/core/network/online";

// Причина, почему работа не началась, без запроса к Rust: например,
// действию нужна интеграция, которой нет. null убирает причину.
export function reportProblem(problem: ChatProblem | null) {
  chatStore.setState((state) => ({ ...state, problem }));
}

// Сообщение агенту способом, который выбран в момент отправки. Пока ответ
// идёт, его строки живут в chatStore, а после него история читается заново
// из Rust. Второе сообщение, пока идёт первое, не уходит. away это действие
// по расписанию: человека нет, и агент правит без вопросов, а на свои
// вопросы решает сам. Отказ, который Rust записал строкой в историю, внизу
// чата второй раз не встаёт.
export function useSend() {
  const queryClient = useQueryClient();

  return useCallback(
    async (model: string, text: string, context: ChatContext, away = false) => {
      const { live, askEdits } = chatStore.get();

      if (live !== null) {
        return;
      }

      const asked: ChatEntry[] = [];
      let oversight: Oversight = "trust";

      if (text.trim() !== "") {
        asked.push({ kind: "user", text });
      }

      if (away) {
        oversight = "away";
      } else if (askEdits) {
        oversight = "ask";
      }

      chatStore.setState((state) => ({ ...state, live: asked, problem: null }));

      const method = await currentMethod(queryClient);
      let problem: ChatProblem | null = null;

      try {
        await agentSend(method, model, text, context, oversight, receive);
      } catch (error) {
        problem = chatProblemOf(error);
      }

      await finish(queryClient);

      if (problem !== null && !isNoted(queryClient.getQueryData(historyKey(method)), problem)) {
        reportProblem(problem);
      }
    },
    [queryClient],
  );
}

// Задание агенту от кнопки соседнего модуля, например «Разбить на задачи».
// Уходит обычным сообщением выбранной модели, ход виден в чате.
export function useAsk() {
  const send = useSend();

  return useCallback(
    (text: string, context: ChatContext) => {
      reportProblem(null);
      void send(modelStore.get(), text, context);
    },
    [send],
  );
}

// Чат хранилища способом, который выбран сейчас: сохранённая история
// и ответ, который идёт сейчас.
export function useChat() {
  const queryClient = useQueryClient();
  const method = useAgentMethod();
  const history = useQuery({ queryKey: historyKey(method), queryFn: () => agentHistory(method) });
  // Сессия Claude Code, чтобы продолжить разговор в терминале. Читается
  // заранее: в буфер обмена окно пишет сразу по нажатию.
  const session = useQuery({
    queryKey: [...HISTORY_KEY, "session"],
    queryFn: agentClaudeSession,
    enabled: method === "subscription",
  });
  const { live, problem, open, askEdits } = useSelector(chatStore);
  const send = useSend();

  // Окно открылось заново посреди ответа, например после перезагрузки:
  // ответ и открытый вопрос снова видны здесь. Не вышло подключиться,
  // и чат просто покажет историю, когда ответ кончится.
  useEffect(() => {
    void agentAttach(receive).then(
      async (ran) => {
        if (ran) {
          await finish(queryClient);
        }
      },
      () => {},
    );
  }, [queryClient]);

  // Ответ на вопрос агента или на просьбу разрешить правку. Лента ставит
  // его сразу, тем же событием, что потом пришлёт Rust.
  const answer = useCallback(async (id: string, reply: Answer) => {
    let shown: string | null = null;

    if (reply.kind === "text") {
      shown = reply.text;
    }

    receive({ kind: "answered", id, answer: shown });

    try {
      await agentAnswer(id, reply);
    } catch (error) {
      reportProblem(chatProblemOf(error));
    }
  }, []);

  // «Стоп» снимает и открытый вопрос.
  const stop = useCallback(() => {
    chatStore.setState((state) => ({ ...state, open: null }));

    return agentStop();
  }, []);

  const setAskEdits = useCallback((value: boolean) => {
    chatStore.setState((state) => ({ ...state, askEdits: value }));
  }, []);

  // Новый разговор снова спрашивает разрешения на правки. У подписки это
  // и новая сессия Claude Code.
  const clear = useCallback(async () => {
    reportProblem(null);
    setAskEdits(true);

    try {
      await agentClear(method);
    } catch (error) {
      reportProblem(chatProblemOf(error));
    }

    await queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
  }, [method, queryClient, setAskEdits]);

  // Строки только дописываются в конец, поэтому номер строки годится ей
  // в ключ: после конца ответа строки истории встают на те же номера.
  const entries = [...(history.data ?? []), ...(live ?? [])].map((entry, id) => ({ id, entry }));

  return {
    method,
    entries,
    loaded: history.data !== undefined,
    running: live !== null,
    problem,
    open,
    askEdits,
    session: session.data ?? null,
    setAskEdits,
    send,
    answer,
    stop,
    clear,
  };
}
