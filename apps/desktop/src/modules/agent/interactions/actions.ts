import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnline } from "@/core/network/online";
import {
  actionsCreate,
  actionsDelete,
  actionsList,
  actionsWrite,
  agentSessionNew,
  terminalRun,
} from "../infrastructure/agent.api";
import { readRuns, writeRun } from "../infrastructure/agent.device";
import { actionsOf, dueActions, hotkeyOf, isRunnable, taskAt, type Action } from "../model/actions";
import { homeProject } from "../model/sessions";
import { openSession, SESSIONS_KEY, useActiveSession, useProjects, useSessions } from "./sessions";
import { queueTask } from "./terminal";

const ACTIONS_KEY = ["agent", "actions"] as const;

export function useActionFiles() {
  return useQuery({ queryKey: ACTIONS_KEY, queryFn: actionsList });
}

// Действия, которые можно запустить: с заданием.
function useActionList() {
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

// Задание к запуску с датами периода. Запуск запоминается: от него
// считается {{since}} следующего.
function taskOf(action: Action) {
  const now = new Date();
  const task = taskAt(action, readRuns()[action.path], now);

  writeRun(action.path, { at: now.getTime(), ran: true });
  return task;
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

// Запуск по клавише или кнопке: новая сессия сразу открывается вкладкой,
// а задание уходит первым сообщением её Claude Code. onRun показывает
// вкладки, а без годного проекта первый шаг, добавить его.
export function useLaunchAction(onRun: () => void) {
  const fresh = useFreshSession();

  return useCallback(
    async (action: Action) => {
      const session = await fresh();

      if (session !== null) {
        queueTask(session.id, taskOf(action));
        openSession(session);
      }

      onRun();
    },
    [fresh, onRun],
  );
}

type Options = {
  // Действие запущено клавишей: страница показывает вкладки.
  onRun: () => void;
};

// Клавиши и расписание действий, пока смонтирована оболочка окна.
// Действие по расписанию идёт в новой сессии без вкладки, чтобы не
// вмешиваться в работу человека, и экран за ним не переключается. Срок,
// пропущенный без сети или без проекта, ждёт их, и окно говорит, что
// действие отложено. Все действия, чей срок пришёл, уходят сразу, каждое
// в своей сессии.
export function useActionTriggers({ onRun }: Options) {
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

        const task = taskOf(action);

        // Claude Code не запустился, например пропал: задание уйдёт, когда
        // человек откроет сессию.
        void terminalRun(session.id, task).catch(() => queueTask(session.id, task));
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
  }, [ready, actions, online, freshSession]);

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
