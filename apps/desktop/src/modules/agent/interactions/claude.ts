import { queryOptions, useQuery } from "@tanstack/react-query";
import { agentClaudeStatus } from "../infrastructure/agent.api";

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
