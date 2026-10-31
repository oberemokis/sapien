import { useMutation, useQuery } from "@tanstack/react-query";
import { securityReset, securityStatus } from "../infrastructure/security.api";

// Шифрование диска человек включает в настройках системы, а не здесь,
// поэтому ответ переспрашивается, когда окно возвращается из них. Чаще
// минуты незачем: опрос запускает команду системы.
export function useSecurityStatus() {
  return useQuery({ queryKey: ["security"], queryFn: securityStatus, staleTime: 60_000, retry: false }).data;
}

// После чистого старта окно перезагружается: кеши в памяти от прежних
// данных, и начинать надо с пустого.
export function useResetData() {
  const reset = useMutation({
    mutationFn: securityReset,
    onSuccess: () => window.location.reload(),
  });

  return { reset: () => reset.mutate(), resetting: reset.isPending, failed: reset.isError };
}
