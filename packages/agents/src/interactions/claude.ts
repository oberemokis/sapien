import { queryOptions, useQuery } from "@tanstack/react-query";
import { commands } from "@sapien/ipc";

// Проверка запускает Claude Code на устройстве, поэтому повторяется
// только по кнопке в настройках.
const claudeStatusQuery = queryOptions({
  queryKey: ["agent", "claude"],
  queryFn: commands.agentClaudeStatus,
  retry: false,
  staleTime: Infinity,
});

export function useClaudeStatus() {
  const query = useQuery(claudeStatusQuery);

  return { status: query.data, failed: query.isError, checking: query.isFetching, check: query.refetch };
}
