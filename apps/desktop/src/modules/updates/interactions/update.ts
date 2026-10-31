import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOnline } from "@/core/network/online";
import { appVersion, updateCheck, updateInstall } from "../infrastructure/updates.api";
import { updateProblemOf, type Update, type UpdateProblem, type UpdateProgress } from "../model/update";

const CHECK_KEY = ["updates", "check"] as const;

// Раз в шесть часов. Проверка при запуске идёт сама: кеша ещё нет.
const CHECK_EVERY = 6 * 60 * 60 * 1000;

function problemOf({ isError, error }: { isError: boolean; error: unknown }): UpdateProblem | null {
  if (!isError) {
    return null;
  }

  return updateProblemOf(error);
}

export function useAppVersion() {
  return useQuery({ queryKey: ["updates", "version"], queryFn: appVersion, staleTime: Infinity }).data;
}

// Последний релиз GitHub. Без сети проверки нет вовсе, а не ошибка:
// она пройдёт, когда сеть вернётся. Окно, свёрнутое дольше шести часов,
// проверяет при возврате. Повтора нет: следующая проверка и так придёт.
export function useUpdateCheck() {
  const online = useOnline();
  const check = useQuery({
    queryKey: CHECK_KEY,
    queryFn: updateCheck,
    enabled: online,
    staleTime: CHECK_EVERY,
    refetchInterval: CHECK_EVERY,
    retry: false,
  });

  return {
    update: check.data,
    checkedAt: check.dataUpdatedAt,
    checking: check.isFetching,
    problem: problemOf(check),
    online,
    recheck: () => void check.refetch(),
  };
}

// Найденная версия, пока человек не ответил «Позже». Ответ держится до
// следующей проверки: она приходит с новым временем и снова показывает
// обновление. Ошибки проверки здесь не видны, только в настройках.
export function useUpdateOffer() {
  const { update, checkedAt } = useUpdateCheck();
  const [deferredAt, setDeferredAt] = useState(0);
  let offered: Update | null = null;

  if (checkedAt > deferredAt) {
    offered = update ?? null;
  }

  return { update: offered, defer: () => setDeferredAt(checkedAt) };
}

// Загрузка и установка. Удачная перезапускает приложение и сюда не
// возвращается, а отказ оставляет установленную версию работать.
export function useUpdateInstall() {
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const install = useMutation({
    mutationFn: () => updateInstall(setProgress),
    onMutate: () => setProgress(null),
  });

  return {
    install: () => install.mutate(),
    installing: install.isPending,
    progress,
    problem: problemOf(install),
  };
}
