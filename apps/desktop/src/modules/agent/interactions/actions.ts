import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  actionsCreate,
  actionsDelete,
  actionsList,
  actionsWrite,
  agentSessionNew,
} from "../infrastructure/agent.api";
import { readRuns, writeRun } from "../infrastructure/agent.device";
import { actionsOf, dueActions, hotkeyOf, isRunnable, taskAt, type Action } from "../model/actions";
import type { Choice } from "../model/agents";
import { chatProblemOf } from "../model/chat";
import { homeProject } from "../model/sessions";
import { choiceFor } from "./agents";
import { reportProblem, useOnline, useRunning, useSend } from "./chat";
import { openSession, SESSIONS_KEY, useActiveSession, useProjects, useSessions } from "./sessions";

const ACTIONS_KEY = ["agent", "actions"] as const;

export function useActionFiles() {
  return useQuery({ queryKey: ACTIONS_KEY, queryFn: actionsList });
}

// Действия, которые можно запустить: с заданием.
export function useActionList() {
  const files = useActionFiles();

  return useMemo(() => actionsOf(files.data ?? []).filter(isRunnable), [files.data]);
}

function useInvalidateActions() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: ACTIONS_KEY });
}

export function useCreateAction() {
  const invalidate = useInvalidateActions();

  return useMutation({
    mutationFn: ({ name, text }: { name: string; text: string }) => actionsCreate(name, text),
    onSettled: invalidate,
  });
}

export function useWriteAction() {
  const invalidate = useInvalidateActions();

  return useMutation({
    mutationFn: ({ path, text }: { path: string; text: string }) => actionsWrite(path, text),
    onSettled: invalidate,
  });
}

export function useDeleteAction() {
  const invalidate = useInvalidateActions();

  return useMutation({ mutationFn: actionsDelete, onSettled: invalidate });
}

// Задание уходит с датами периода, а запуск запоминается: от него
// считается {{since}} следующего. away у запуска по расписанию: человека
// рядом нет.
function useStart() {
  const queryClient = useQueryClient();
  const send = useSend();

  return useCallback(
    async (action: Action, session: string, away = false) => {
      const now = new Date();
      const task = taskAt(action, readRuns()[action.path], now);

      writeRun(action.path, { at: now.getTime(), ran: true });

      let choice: Choice | null;

      // Rust не отдал список агентов: в чате его причина, а не «агентов нет».
      try {
        choice = await choiceFor(queryClient, session);
      } catch (error) {
        reportProblem(session, chatProblemOf(error));
        return;
      }

      // Агентов на устройстве нет: запуск помечен, причину видно в чате.
      if (choice === null) {
        reportProblem(session, "claude_missing");
        return;
      }

      reportProblem(session, null);
      await send(session, choice, task, away);
    },
    [queryClient, send],
  );
}

// Запуск действия в сессии, например из «/» в чате. Задание уходит
// обычным сообщением, поэтому инструменты идут по тем же правилам.
export function useRunAction() {
  return useStart();
}

// Новая сессия для действия. null: годного проекта нет или Rust отказал,
// например папка пропала между проверкой и запросом. Запускать негде.
function useFreshSession() {
  const queryClient = useQueryClient();
  const projects = useProjects().data;
  const sessions = useSessions().data;
  const active = useActiveSession();

  return useCallback(async () => {
    const project = homeProject(projects ?? [], sessions ?? [], active?.id ?? null);

    if (project === null) {
      return null;
    }

    const session = await agentSessionNew(project).catch(() => null);

    await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

    return session;
  }, [projects, sessions, active, queryClient]);
}

// Запуск по клавише или кнопке: в активной вкладке, а без неё или пока
// она отвечает в новой сессии: второе сообщение в отвечающую сессию не
// уходит. Сессия открывается, onRun показывает чат. Без сети сессия
// открывается, а задание не уходит: причину покажет чат.
export function useLaunchAction(onRun: () => void) {
  const start = useStart();
  const fresh = useFreshSession();
  const online = useOnline();
  const active = useActiveSession();
  const running = useRunning();

  return useCallback(
    async (action: Action) => {
      let session = active;

      if (session === null || running(session.id)) {
        session = await fresh();
      }

      if (session === null) {
        onRun();
        return;
      }

      openSession(session);
      onRun();

      if (online) {
        await start(action, session.id);
      }
    },
    [active, fresh, online, onRun, running, start],
  );
}

type Options = {
  // Действие запущено клавишей: страница показывает чат.
  onRun: () => void;
};

// Клавиши и расписание действий, пока смонтирована оболочка окна.
// Действие по расписанию идёт в новой сессии, чтобы не вмешиваться
// в разговор человека, и экран за ним не переключается. Срок, пропущенный
// без сети или без проекта, ждёт их, и окно говорит, что действие
// отложено. Ответы сессий идут параллельно, поэтому все действия, чей
// срок пришёл, уходят сразу, каждое в своей сессии.
export function useActionTriggers({ onRun }: Options) {
  const start = useStart();
  const online = useOnline();
  const actions = useActionList();
  const projects = useProjects().data;
  const sessions = useSessions().data;
  const freshSession = useFreshSession();
  const launch = useLaunchAction(onRun);
  const [deferred, setDeferred] = useState<string[]>([]);
  // Тики идут по одному: следующий читает запуски, когда прошлый их уже
  // записал, и не заводит второй сессии тому же сроку.
  const ticking = useRef(Promise.resolve());
  const ready = projects !== undefined && sessions !== undefined;

  useEffect(() => {
    if (!ready) {
      return;
    }

    // Новая сессия меняет список сессий, и эффект перезапускается. Тик
    // прошлого эффекта доводит начатый срок и уступает следующему.
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
        if (stopped) {
          return;
        }

        if (!online) {
          waiting.push(action.name);
          continue;
        }

        // oxlint-disable-next-line no-await-in-loop -- сессии заводятся по одной: остановка эффекта обрывает цикл между ними
        const session = await freshSession();

        if (session === null) {
          waiting.push(action.name);
          continue;
        }

        // Заведённая сессия получает задание и после остановки эффекта,
        // иначе она осталась бы пустой.
        void start(action, session.id, true);
      }

      setDeferred(waiting);
    }

    // Упавший тик не останавливает следующие.
    function queue() {
      ticking.current = ticking.current.then(tick, tick);
    }

    queue();
    const timer = setInterval(queue, 60_000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [ready, actions, online, freshSession, start]);

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
      void launch(action);
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, launch]);

  return { deferred };
}
