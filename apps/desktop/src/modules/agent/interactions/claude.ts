import { queryOptions, useQuery } from "@tanstack/react-query";
import { agentClaudeStatus, agentUsage } from "../infrastructure/agent.api";

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

// Лимиты спрашиваются, только пока их видно: каждый запрос запускает
// Claude Code. Открытая карточка обновляет их раз в минуту, а открытая
// заново берёт прочитанные меньше минуты назад.
export function useUsage(shown: boolean) {
  const query = useQuery({
    queryKey: ["agent", "usage"],
    queryFn: agentUsage,
    enabled: shown,
    retry: false,
    staleTime: 60_000,
    refetchInterval: shown && 60_000,
  });

  return {
    usage: query.data,
    failed: query.isError && !query.isFetching,
    updated: query.dataUpdatedAt,
    retry: query.refetch,
  };
}
