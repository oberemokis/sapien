import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { youtrackConnect, youtrackDisconnect, youtrackStatus } from "../infrastructure/youtrack.api";

export const YOUTRACK_KEY = ["youtrack"] as const;

// Подключение к YouTrack. Токен уходит в Rust мимо кеша мутаций: там он
// пролежал бы в памяти окна ещё несколько минут. Без сети сервер просто
// недоступен, повтор тут не поможет: проверить снова можно кнопкой.
export function useYoutrack() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: YOUTRACK_KEY, queryFn: youtrackStatus, retry: false });

  const connect = useCallback(
    async (host: string, token: string) => {
      queryClient.setQueryData(YOUTRACK_KEY, await youtrackConnect(host, token));
    },
    [queryClient],
  );

  const disconnect = useCallback(async () => {
    await youtrackDisconnect();
    await queryClient.invalidateQueries({ queryKey: YOUTRACK_KEY });
  }, [queryClient]);

  const recheck = useCallback(() => queryClient.invalidateQueries({ queryKey: YOUTRACK_KEY }), [queryClient]);

  return { status: status.data, checking: status.isFetching, connect, disconnect, recheck };
}

// Подключён ли YouTrack сейчас: проверка перед работой, которой он нужен.
// Ответ минутной давности берётся из кеша, иначе Rust спрашивает сервер.
export function useYoutrackCheck() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    try {
      const status = await queryClient.fetchQuery({
        queryKey: YOUTRACK_KEY,
        queryFn: youtrackStatus,
        retry: false,
        staleTime: 60_000,
      });

      return status.kind === "connected";
    } catch {
      return false;
    }
  }, [queryClient]);
}
