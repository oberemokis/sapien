import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentIntegrationInstall, agentIntegrationRemove, agentIntegrations } from "../infrastructure/agent.api";
import type { Agent } from "../model/sessions";

const INTEGRATIONS_KEY = ["agent", "integrations"] as const;

export function useIntegrations() {
  return useQuery({ queryKey: INTEGRATIONS_KEY, queryFn: agentIntegrations });
}

function toggle({ agent, on }: { agent: Agent; on: boolean }) {
  if (on) {
    return agentIntegrationInstall(agent);
  }

  return agentIntegrationRemove(agent);
}

// Ставит или снимает интеграцию агента. После ответа список перечитывается:
// он смотрит в настройки агента сам.
export function useToggleIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggle,
    onSettled: () => queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY }),
  });
}
