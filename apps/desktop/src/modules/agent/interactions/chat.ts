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
import { chatStore, draftStore } from "../store/chat.store";
import { SESSIONS_KEY } from "./sessions";

// История у каждой сессии своя. Rust пишет её и посреди ответа, поэтому
// окно читает историю до ответа и после него, но не во время: прочитанная
// посреди, она повторила бы строки, которые чат уже показывает из ответа.
const HISTORY_KEY = ["agent", "history"] as const;

function historyKey(session: string) {
  return [...HISTORY_KEY, session] as const;
}

function historyQuery(session: string) {
  return { queryKey: historyKey(session), queryFn: () => agentHistory(session), staleTime: Infinity };
}

function without<Value>(record: Record<string, Value>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

// Событие идущего ответа сессии: его строки и вопрос, который ждёт человека.
function receive(session: string, event: ChatEvent) {
  chatStore.setState((state) => {
    const run = state.runs[session];

    if (run === undefined) {
      return state;
    }

    let open = run.open;

    if (event.kind === "asked") {
      open = event.question.id;
    }

    if (event.kind === "answered" && event.id === open) {
      open = null;
    }

    return { ...state, runs: { ...state.runs, [session]: { entries: applyEvent(run.entries, event), open } } };
  });
}

// Ответ кончился: история сессии читается заново из Rust, там уже всё,
// что дошло. Список сессий тоже: у сессии новое название и время.
async function finish(queryClient: QueryClient, session: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: historyKey(session) }),
    queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  ]);
  chatStore.setState((state) => ({ ...state, runs: without(state.runs, session) }));
}

export { useOnline } from "@/core/network/online";

// Причина, почему ответ сессии не дошёл. null убирает причину.
export function reportProblem(session: string, code: ChatProblem | null) {
  chatStore.setState((state) => {
    if (code === null) {
      return { ...state, problems: without(state.problems, session) };
    }

    return { ...state, problems: { ...state.problems, [session]: code } };
  });
}

// Сообщение агенту в сессию. Пока ответ идёт, его строки живут в chatStore,
// а после него история читается заново из Rust. Ответы разных сессий идут
// параллельно, а в одной сессии второе сообщение, пока идёт первое, не
// уходит. away это действие по расписанию: человека нет, и агент работает
// без вопросов, а на свои вопросы решает сам. Отказ, который Rust записал
// строкой в историю, внизу чата второй раз не встаёт.
export function useSend() {
  const queryClient = useQueryClient();

  return useCallback(
    async (session: string, model: string, text: string, away = false) => {
      const { runs, askEdits } = chatStore.get();

      if (runs[session] !== undefined) {
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

      chatStore.setState((state) => ({
        ...state,
        runs: { ...state.runs, [session]: { entries: asked, open: null } },
        problems: without(state.problems, session),
      }));
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
        // Вкладка сессии может открыться посреди ответа: история к этому
        // времени уже прочитана, до ответа.
        await queryClient.fetchQuery(historyQuery(session)).catch(() => {});
        await agentSend(session, model, text, oversight, (event) => receive(session, event));
      } catch (error) {
        problem = chatProblemOf(error);
      }

      await finish(queryClient, session);

      if (problem !== null && !isNoted(queryClient.getQueryData(historyKey(session)), problem)) {
        reportProblem(session, problem);
      }
    },
    [queryClient],
  );
}

// Окно открылось заново посреди ответов, например после перезагрузки:
// ответы и открытые вопросы снова видны в своих сессиях. Подключается один
// раз за жизнь окна: второй канал задвоил бы строки. Не вышло подключиться,
// и чат просто покажет историю, когда ответ кончится.
let attached = false;

async function attach(queryClient: QueryClient, session: string) {
  if (chatStore.get().runs[session] !== undefined) {
    return;
  }

  chatStore.setState((state) => ({ ...state, runs: { ...state.runs, [session]: { entries: [], open: null } } }));

  try {
    await agentAttach(session, (event) => receive(session, event));
  } finally {
    await finish(queryClient, session);
  }
}

export function useAttach() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (attached) {
      return;
    }

    attached = true;
    agentRunning()
      .then((sessions) => Promise.all(sessions.map((session) => attach(queryClient, session).catch(() => {}))))
      .catch(() => {});
  }, [queryClient]);
}

// Чат сессии: сохранённая история и ответ, если он идёт в этой сессии.
export function useChat(session: string) {
  const history = useQuery(historyQuery(session));
  const run = useSelector(chatStore, (state) => state.runs[session] ?? null);
  const problem = useSelector(chatStore, (state) => state.problems[session] ?? null);
  const askEdits = useSelector(chatStore, (state) => state.askEdits);
  const send = useSend();

  // Ответ на вопрос агента или на просьбу разрешить инструмент. Лента
  // ставит его сразу, тем же событием, что потом пришлёт Rust.
  const answer = useCallback(
    async (id: string, reply: Answer) => {
      let shown: string | null = null;

      if (reply.kind === "text") {
        shown = reply.text;
      }

      receive(session, { kind: "answered", id, answer: shown });

      try {
        await agentAnswer(session, id, reply);
      } catch (error) {
        reportProblem(session, chatProblemOf(error));
      }
    },
    [session],
  );

  // «Стоп» снимает и открытый вопрос.
  const stop = useCallback(() => {
    chatStore.setState((state) => {
      const current = state.runs[session];

      if (current === undefined) {
        return state;
      }

      return { ...state, runs: { ...state.runs, [session]: { ...current, open: null } } };
    });

    return agentStop(session);
  }, [session]);

  const setAskEdits = useCallback((value: boolean) => {
    chatStore.setState((state) => ({ ...state, askEdits: value }));
  }, []);

  // Строки только дописываются в конец, поэтому номер строки годится ей
  // в ключ: после конца ответа строки истории встают на те же номера.
  const entries = [...(history.data ?? []), ...(run?.entries ?? [])].map((entry, id) => ({ id, entry }));

  return {
    entries,
    loaded: history.data !== undefined,
    running: run !== null,
    problem,
    open: run?.open ?? null,
    askEdits,
    setAskEdits,
    send: (model: string, text: string) => send(session, model, text),
    answer,
    stop,
  };
}

// Черновик сессии: чат берёт его, когда открывается, и пишет при наборе.
export function draftOf(session: string) {
  return draftStore.get()[session] ?? "";
}

export function writeDraft(session: string, text: string) {
  draftStore.setState((drafts) => ({ ...drafts, [session]: text }));
}

// Идёт ли ответ в сессии: список сессий и вкладки отмечают её.
export function useRunning() {
  const runs = useSelector(chatStore, (state) => state.runs);

  return (session: string) => runs[session] !== undefined;
}
