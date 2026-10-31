import { useCallback, useEffect, useMemo, useState } from "react";
import { readRuns, writeRun } from "../infrastructure/agent.device";
import { actionsOf, dueActions, hotkeyOf, isRunnable, taskAt, type Action, type Integration } from "../model/actions";
import type { ChatContext, ChatProblem } from "../model/chat";
import { chatStore } from "../store/chat.store";
import { modelStore } from "../store/model.store";
import { reportProblem, useOnline, useSend } from "./chat";

// Отказ, когда интеграция действия не подключена.
const MISSING: Record<Integration, ChatProblem> = { youtrack: "needsYoutrack" };

// Действие по расписанию запускается без открытой заметки: оно не про то,
// что у человека на экране в эту минуту.
const NOWHERE: ChatContext = { path: null, selection: "" };

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
  // Действия по расписанию, чей срок прошёл, а сети или интеграции нет.
  const [deferred, setDeferred] = useState<string[]>([]);

  const ready = useCallback(
    async (action: Action) => {
      for (const integration of action.integrations) {
        // Проверки идут по очереди: первая же отсутствующая и есть причина.
        // oxlint-disable-next-line no-await-in-loop
        if (!(await check[integration]())) {
          return MISSING[integration];
        }
      }

      return null;
    },
    [check],
  );

  // Задание уходит с датами периода, а запуск запоминается: от него
  // считается {{since}} следующего. away у запуска по расписанию: человека
  // рядом нет.
  const start = useCallback(
    (action: Action, where: ChatContext, away = false) => {
      const now = new Date();
      const task = taskAt(action, readRuns()[action.path], now);

      writeRun(action.path, { at: now.getTime(), ran: true });

      return send(modelStore.get(), task, where, away);
    },
    [send],
  );

  const run = useCallback(
    async (action: Action, where: ChatContext) => {
      onRun();

      if (!online) {
        return;
      }

      reportProblem(null);

      const missing = await ready(action);

      if (missing !== null) {
        reportProblem(missing);

        return;
      }

      await start(action, where);
    },
    [online, onRun, ready, start],
  );

  // Расписание проверяется при открытии и раз в минуту. Новое действие
  // только замечается. Пропущенный срок без сети или интеграции ждёт их,
  // и окно говорит, что действие отложено. Чат берёт одно сообщение
  // за раз, поэтому за проверку уходит одно действие.
  useEffect(() => {
    let stopped = false;

    async function tick() {
      const now = new Date();
      const runs = readRuns();
      const waiting: string[] = [];

      for (const action of actions) {
        if (action.schedule !== null && runs[action.path] === undefined) {
          writeRun(action.path, { at: now.getTime(), ran: false });
        }
      }

      for (const action of dueActions(actions, runs, now)) {
        // oxlint-disable-next-line no-await-in-loop -- за проверку уходит одно действие
        const prepared = online && (await ready(action)) === null;

        if (stopped) {
          return;
        }

        if (!prepared) {
          waiting.push(action.name);
        } else if (chatStore.get().live === null) {
          onRun();
          void start(action, NOWHERE, true);
          break;
        }
      }

      setDeferred(waiting);
    }

    void tick();
    const timer = setInterval(() => void tick(), 60_000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [actions, online, onRun, ready, start]);

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

  return { actions, online, run, deferred };
}
