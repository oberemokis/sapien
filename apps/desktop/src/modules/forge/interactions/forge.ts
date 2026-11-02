import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { forgeConnect, forgeDisconnect, forgeStatus } from "../infrastructure/forge.api";
import type { Forge } from "../model/forge";

const STATUS_KEY = ["forge", "status"] as const;

export function useForgeStatus() {
  return useQuery({ queryKey: STATUS_KEY, queryFn: forgeStatus });
}

export function useForgeConnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ forge, host, token }: { forge: Forge; host: string | null; token: string }) =>
      forgeConnect(forge, host, token),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}

export function useForgeDisconnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: forgeDisconnect,
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}
