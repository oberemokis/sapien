import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { deleteSecret, saveSecret, secretStatus } from "@/core/secrets/secrets";

const KEY = ["secret", "model_key"] as const;

// Ключ API провайдера модели: задан ли он и чем заканчивается. Сам ключ
// уходит в Rust мимо кеша мутаций: там он пролежал бы в памяти окна ещё
// несколько минут.
export function useModelKey() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: KEY, queryFn: () => secretStatus("model_key"), retry: false });

  const save = useCallback(
    async (value: string) => {
      queryClient.setQueryData(KEY, await saveSecret("model_key", value));
    },
    [queryClient],
  );

  const remove = useCallback(async () => {
    await deleteSecret("model_key");
    await queryClient.invalidateQueries({ queryKey: KEY });
  }, [queryClient]);

  return { status: status.data, save, remove };
}
