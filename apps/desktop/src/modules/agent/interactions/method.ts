import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { agentClaudeStatus } from "../infrastructure/agent.api";
import { readAgentMethod, writeAgentMethod } from "../infrastructure/agent.device";
import { parseAgentMethod, resolveMethod, type AgentMethod, type ClaudeStatus } from "../model/method";
import { methodStore } from "../store/method.store";

methodStore.setState(() => parseAgentMethod(readAgentMethod()));

// Проверка запускает Claude Code на устройстве, поэтому повторяется
// только по кнопке в настройках.
const claudeStatusQuery = queryOptions({
  queryKey: ["agent", "claude"],
  queryFn: agentClaudeStatus,
  retry: false,
  staleTime: Infinity,
});

export function useClaudeStatus() {
  const query = useQuery(claudeStatusQuery);

  return { status: query.data, failed: query.isError, checking: query.isFetching, check: query.refetch };
}

// Способ, которым агент идёт сейчас.
export function useAgentMethod() {
  const chosen = useSelector(methodStore);
  const { status } = useClaudeStatus();

  return resolveMethod(chosen, status);
}

export function setAgentMethod(method: AgentMethod) {
  methodStore.setState(() => method);
  writeAgentMethod(method);
}

// Способ на момент запуска. Без выбора человека он зависит от Claude Code,
// и запуск дожидается проверки.
export async function currentMethod(queryClient: QueryClient) {
  const chosen = methodStore.state;
  let claude: ClaudeStatus | undefined;

  if (chosen === null) {
    claude = await queryClient.ensureQueryData(claudeStatusQuery).catch(() => undefined);
  }

  return resolveMethod(chosen, claude);
}
