import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { agentCommands, agentProviders } from "../infrastructure/agent.api";
import { readChoice, writeChoice } from "../infrastructure/agent.device";
import { fitChoice, wantedChoice, type Choice, type Commands } from "../model/agents";
import type { Project, SessionInfo } from "../model/sessions";
import { choiceStore } from "../store/choice.store";
import { SESSIONS_KEY } from "./sessions";

const NO_COMMANDS: Commands = { commands: [], agents: [] };

choiceStore.setState((state) => ({ ...state, last: readChoice() }));

// Список агентов Rust собирает, запуская их на устройстве, поэтому он
// читается раз за жизнь окна и по кнопке «Проверить» в настройках.
const providersQuery = queryOptions({
  queryKey: ["agent", "providers"],
  queryFn: agentProviders,
  retry: false,
  staleTime: Infinity,
});

export function useProviders() {
  return useQuery(providersQuery);
}

// Команды и скилы агента в папке проекта. Их тоже собирает запуск агента,
// поэтому список живёт пять минут: новый скил появится без перезапуска
// окна, а набор «/» не запускает агента каждый раз. Без агента или папки
// команд нет. failed: агент не отдал команды, и это не то же, что проект
// без команд.
export function useCommands(provider: string | null, project: Project | undefined) {
  const query = useQuery({
    queryKey: ["agent", "commands", provider, project?.id],
    queryFn: () => agentCommands(provider ?? "", project?.id ?? ""),
    enabled: provider !== null && project !== undefined && !project.missing,
    retry: false,
    staleTime: 5 * 60_000,
  });

  return {
    ...(query.data ?? NO_COMMANDS),
    failed: query.isError && !query.isFetching,
    retry: query.refetch,
  };
}

// Выбор сессии и агенты на выбор. locked: разговор в сессии начат, и её
// агент не меняется.
export function useChoice(session: SessionInfo) {
  const providers = useProviders().data ?? [];
  const picked = useSelector(choiceStore, (state) => state.sessions[session.id] ?? null);
  const last = useSelector(choiceStore, (state) => state.last);

  return {
    choice: fitChoice(wantedChoice(session, picked, last), providers),
    providers,
    locked: session.started,
  };
}

// Выбор в сессии становится и последним выбором окна: с ним начнётся
// следующая новая сессия.
export function setChoice(session: string, choice: Choice) {
  choiceStore.setState((state) => ({ last: choice, sessions: { ...state.sessions, [session]: choice } }));
  writeChoice(choice);
}

// Выбор сессии вне чата, например для действия. null: агентов нет.
// Отказ Rust в списке агентов уходит к вызвавшему: это не то же, что
// агентов нет.
export async function choiceFor(queryClient: QueryClient, session: string) {
  const providers = await queryClient.fetchQuery(providersQuery);
  const info = queryClient.getQueryData<SessionInfo[]>(SESSIONS_KEY)?.find((candidate) => candidate.id === session);
  const { sessions, last } = choiceStore.get();
  const picked = sessions[session] ?? null;
  let wanted: Choice | null = picked ?? last;

  if (info !== undefined) {
    wanted = wantedChoice(info, picked, last);
  }

  return fitChoice(wanted, providers);
}
