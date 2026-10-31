import { useCallback, useEffect, useMemo } from "react";
import { actionsOf, hotkeyOf, isRunnable, type Action, type Integration } from "../model/actions";
import type { ChatContext, ChatProblem } from "../model/chat";
import { modelStore } from "../store/model.store";
import { reportProblem, useOnline, useSend } from "./chat";

// Отказ, когда интеграция действия не подключена.
const MISSING: Record<Integration, ChatProblem> = { youtrack: "needsYoutrack" };

type Options = {
  // Заметки папки действий: их приносит страница из хранилища.
  notes: { path: string; text: string }[] | undefined;
  // Что открыто и выделено сейчас: с этим действие уходит по клавише.
  context: ChatContext;
  // Подключена ли интеграция прямо сейчас: её проверяет свой модуль.
  check: Record<Integration, () => Promise<boolean>>;
  // Действие запущено: страница показывает панель чата, ход виден там.
  onRun: () => void;
};

export type ActionLauncher = ReturnType<typeof useActions>;

// Действия хранилища и их запуск. Задание уходит агенту обычным сообщением
// с тем, что открыто, поэтому правки идут по тем же правилам, что в чате.
// Без сети и без нужной интеграции работа не начинается, причина видна
// в чате. Горячие клавиши слушает окно, пока смонтирована страница.
export function useActions({ notes, context, check, onRun }: Options) {
  const send = useSend();
  const online = useOnline();
  const actions = useMemo(() => actionsOf(notes ?? []).filter(isRunnable), [notes]);

  const run = useCallback(
    async (action: Action, where: ChatContext) => {
      onRun();

      if (!online) {
        return;
      }

      reportProblem(null);

      for (const integration of action.integrations) {
        // Проверки идут по очереди: первая же отсутствующая и есть причина.
        // oxlint-disable-next-line no-await-in-loop
        if (!(await check[integration]())) {
          reportProblem(MISSING[integration]);

          return;
        }
      }

      await send(modelStore.get(), action.task, where);
    },
    [check, onRun, online, send],
  );

  // Удалённое действие пропадает из списка, и его клавиша больше ничего
  // не делает.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const hotkey = hotkeyOf(event);
      const action = actions.find((candidate) => candidate.hotkey !== null && candidate.hotkey === hotkey);

      if (event.defaultPrevented || event.repeat || action === undefined) {
        return;
      }

      event.preventDefault();
      void run(action, context);
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, context, run]);

  return { actions, online, run };
}
