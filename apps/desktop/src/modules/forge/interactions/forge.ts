import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type Forge } from "@sapien/ipc";

const STATUS_KEY = ["forge", "status"] as const;

export function useForgeStatus() {
  return useQuery({ queryKey: STATUS_KEY, queryFn: commands.forgeStatus });
}

export function useForgeConnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ forge, host, token }: { forge: Forge; host: string | null; token: string }) =>
      commands.forgeConnect(forge, host, token),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}

export function useForgeDisconnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: commands.forgeDisconnect,
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}
