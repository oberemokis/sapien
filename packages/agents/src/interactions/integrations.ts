import { commands } from "@sapien/ipc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const INTEGRATIONS_KEY = ["agent", "integrations"] as const;

export function useIntegrations() {
  return useQuery({ queryKey: INTEGRATIONS_KEY, queryFn: commands.agentIntegrations });
}

// Rust дописывает хук в настройки агента или кладёт его расширение.
function toggle({ agent, on }: { agent: string; on: boolean }) {
  if (on) {
    return commands.agentIntegrationInstall(agent);
  }

  return commands.agentIntegrationRemove(agent);
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
