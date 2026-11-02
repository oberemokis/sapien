import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect } from "react";
import {
  agentAnswer,
  agentAttach,
  agentHistory,
  agentRunning,
  agentSend,
  agentStop,
} from "../infrastructure/agent.api";
import {
  applyEvent,
  chatProblemOf,
  isNoted,
  type Answer,
  type ChatEntry,
  type ChatEvent,
  type ChatProblem,
  type Oversight,
} from "../model/chat";
import type { SessionInfo } from "../model/sessions";
import { chatStore } from "../store/chat.store";
import { SESSIONS_KEY } from "./sessions";

// История у каждой сессии своя, конец ответа перечитывает все сразу.
const HISTORY_KEY = ["agent", "history"] as const;

function historyKey(session: string) {
  return [...HISTORY_KEY, session] as const;
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
// Список сессий тоже: у сессии новое название и время.
async function finish(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: HISTORY_KEY }),
    queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  ]);
  chatStore.setState((state) => ({ ...state, session: null, live: null, open: null }));
}

export { useOnline } from "@/core/network/online";

// Причина, почему ответ сессии не дошёл. null убирает причину.
export function reportProblem(session: string, code: ChatProblem | null) {
  chatStore.setState((state) => ({ ...state, problem: code && { session, code } }));
}

// Сообщение агенту в сессию. Пока ответ идёт, его строки живут в chatStore,
// а после него история читается заново из Rust. Ответ в приложении один:
// второе сообщение, пока идёт первое, не уходит. away это действие по
// расписанию: человека нет, и агент работает без вопросов, а на свои
// вопросы решает сам. Отказ, который Rust записал строкой в историю, внизу
// чата второй раз не встаёт.
export function useSend() {
  const queryClient = useQueryClient();

  return useCallback(
    async (session: string, model: string, text: string, away = false) => {
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

      chatStore.setState((state) => ({ ...state, session, live: asked, problem: null }));
      // Название новой сессии Rust берёт из первой строки первого сообщения,
      // а список перечитается только в конце ответа: до тех пор оно здесь.
      queryClient.setQueryData<SessionInfo[]>(SESSIONS_KEY, (list) =>
        list?.map((item) => {
          if (item.id !== session || item.title !== "") {
            return item;
          }

          return { ...item, title: text.split("\n")[0]?.slice(0, 60) ?? "" };
        }),
      );

      let problem: ChatProblem | null = null;

      try {
        await agentSend(session, model, text, oversight, receive);
      } catch (error) {
        problem = chatProblemOf(error);
      }

      await finish(queryClient);

      if (problem !== null && !isNoted(queryClient.getQueryData(historyKey(session)), problem)) {
        reportProblem(session, problem);
      }
    },
    [queryClient],
  );
}

// Окно открылось заново посреди ответа, например после перезагрузки:
// ответ и открытый вопрос снова видны в его сессии. Подключается один раз
// за жизнь окна: второй канал задвоил бы строки. Не вышло подключиться,
// и чат просто покажет историю, когда ответ кончится.
let attached = false;

export function useAttach() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (attached) {
      return;
    }

    attached = true;

    async function attach() {
      const session = await agentRunning();

      if (session === null || chatStore.get().live !== null) {
        return;
      }

      chatStore.setState((state) => ({ ...state, session, live: [] }));
      await agentAttach(receive);
      await finish(queryClient);
    }

    attach().catch(() => {});
  }, [queryClient]);
}

// Чат сессии: сохранённая история и ответ, если он идёт в этой сессии.
// busy: ответ идёт в другой сессии, и новое сообщение подождёт его.
export function useChat(session: string) {
  const history = useQuery({ queryKey: historyKey(session), queryFn: () => agentHistory(session) });
  const state = useSelector(chatStore);
  const send = useSend();
  const here = state.session === session;
  let live: ChatEntry[] | null = null;
  let open: string | null = null;
  let problem: ChatProblem | null = null;

  if (here) {
    live = state.live;
    open = state.open;
  }

  if (state.problem?.session === session) {
    problem = state.problem.code;
  }

  // Ответ на вопрос агента или на просьбу разрешить инструмент. Лента
  // ставит его сразу, тем же событием, что потом пришлёт Rust.
  const answer = useCallback(
    async (id: string, reply: Answer) => {
      let shown: string | null = null;

      if (reply.kind === "text") {
        shown = reply.text;
      }

      receive({ kind: "answered", id, answer: shown });

      try {
        await agentAnswer(id, reply);
      } catch (error) {
        reportProblem(session, chatProblemOf(error));
      }
    },
    [session],
  );

  // «Стоп» снимает и открытый вопрос.
  const stop = useCallback(() => {
    chatStore.setState((current) => ({ ...current, open: null }));

    return agentStop();
  }, []);

  const setAskEdits = useCallback((value: boolean) => {
    chatStore.setState((current) => ({ ...current, askEdits: value }));
  }, []);

  // Строки только дописываются в конец, поэтому номер строки годится ей
  // в ключ: после конца ответа строки истории встают на те же номера.
  const entries = [...(history.data ?? []), ...(live ?? [])].map((entry, id) => ({ id, entry }));

  return {
    entries,
    loaded: history.data !== undefined,
    running: live !== null,
    busy: state.live !== null && !here,
    problem,
    open,
    askEdits: state.askEdits,
    setAskEdits,
    send: (model: string, text: string) => send(session, model, text),
    answer,
    stop,
  };
}

// Сессия, чей ответ идёт сейчас: список сессий отмечает её.
export function useRunningSession() {
  return useSelector(chatStore, (state) => state.live && state.session);
}
