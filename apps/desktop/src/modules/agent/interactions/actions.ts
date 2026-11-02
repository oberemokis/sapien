import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  actionsCreate,
  actionsDelete,
  actionsList,
  actionsWrite,
  agentSessionNew,
} from "../infrastructure/agent.api";
import { readRuns, writeRun } from "../infrastructure/agent.device";
import { actionsOf, dueActions, hotkeyOf, isRunnable, taskAt, type Action } from "../model/actions";
import { homeProject } from "../model/sessions";
import { chatStore } from "../store/chat.store";
import { modelStore } from "../store/model.store";
import { reportProblem, useOnline, useSend } from "./chat";
import { selectSession, SESSIONS_KEY, useProjects, useSelectedSession, useSessions } from "./sessions";

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
  const send = useSend();

  return useCallback(
    (action: Action, session: string, away = false) => {
      const now = new Date();
      const task = taskAt(action, readRuns()[action.path], now);

      writeRun(action.path, { at: now.getTime(), ran: true });
      reportProblem(session, null);

      return send(session, modelStore.get(), task, away);
    },
    [send],
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
  const selected = useSelectedSession();

  return useCallback(async () => {
    const project = homeProject(projects ?? [], sessions ?? [], selected);

    if (project === null) {
      return null;
    }

    const session = await agentSessionNew(project).catch(() => null);

    await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

    return session?.id ?? null;
  }, [projects, sessions, selected, queryClient]);
}

// Запуск по клавише или кнопке: в открытой сессии, а без неё в новой.
// Сессия открывается, onRun показывает чат. Без сети сессия открывается,
// а задание не уходит: причину покажет чат.
export function useLaunchAction(onRun: () => void) {
  const start = useStart();
  const fresh = useFreshSession();
  const online = useOnline();
  const selected = useSelectedSession();

  return useCallback(
    async (action: Action) => {
      const session = selected ?? (await fresh());

      if (session === null) {
        onRun();
        return;
      }

      selectSession(session);
      onRun();

      if (online) {
        await start(action, session);
      }
    },
    [selected, fresh, online, onRun, start],
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
// отложено. Ответ в приложении один, поэтому за проверку уходит одно
// действие.
export function useActionTriggers({ onRun }: Options) {
  const start = useStart();
  const online = useOnline();
  const actions = useActionList();
  const projects = useProjects().data;
  const sessions = useSessions().data;
  const freshSession = useFreshSession();
  const launch = useLaunchAction(onRun);
  const [deferred, setDeferred] = useState<string[]>([]);
  const ready = projects !== undefined && sessions !== undefined;

  useEffect(() => {
    if (!ready) {
      return;
    }

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
        if (!online) {
          waiting.push(action.name);
        } else if (chatStore.get().live === null) {
          // oxlint-disable-next-line no-await-in-loop -- за проверку уходит одно действие
          const session = await freshSession();

          if (stopped) {
            return;
          }

          if (session === null) {
            waiting.push(action.name);
            continue;
          }

          void start(action, session, true);
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
