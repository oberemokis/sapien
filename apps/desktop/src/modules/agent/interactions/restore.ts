import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { commands, type Project, type SessionInfo } from "@sapien/ipc";
import { tabsStore } from "../store/sessions.store";
import { sessionPanes } from "./panes";
import { useProjects } from "@sapien/projects";
import { useSessions } from "./sessions";

// Дольше окно запуска не ждёт: оболочка, которая так и не ответила,
// покажет плашку в своей панели.
const RESTORE_WAIT = 5000;

type Restoration = { done: boolean; promise: Promise<void> };

// Вкладки поднимаются один раз за жизнь окна, а не при каждом возврате
// из настроек. Клиент Query у окна один на всю его жизнь.
const restorations = new WeakMap<QueryClient, Restoration>();

// Оболочки всех панелей открытых вкладок всех проектов. Rust набирает
// в них команду, которой агент продолжает свой разговор. Проект без
// папки и удалённая сессия пропускаются, отказ одной панели не держит
// остальные.
async function restore(projects: Project[], sessions: SessionInfo[]) {
  const usable = new Set(projects.filter((project) => !project.missing).map((project) => project.id));
  const known = new Set(sessions.map((session) => session.id));
  const starts = Object.entries(tabsStore.get().projects)
    .filter(([project]) => usable.has(project))
    .flatMap(([, tabs]) => tabs.sessions)
    .filter((session) => known.has(session))
    .flatMap((session) => sessionPanes(session).map((pane) => commands.terminalStart(session, pane).catch(() => null)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, RESTORE_WAIT);
  });

  await Promise.race([Promise.all(starts), late]);
  clearTimeout(timer);
}

// Готово ли окно: открытые вкладки подняты. Пока нет, оно показывает
// загрузку, а не вкладки, которые ещё запускаются.
export function useRestoredTabs() {
  const queryClient = useQueryClient();
  const projects = useProjects();
  const sessions = useSessions();
  const [ready, setReady] = useState(() => restorations.get(queryClient)?.done ?? false);
  const loaded = !projects.isPending && !sessions.isPending;

  useEffect(() => {
    if (ready || !loaded) {
      return;
    }

    let restoration = restorations.get(queryClient);

    if (restoration === undefined) {
      const created: Restoration = { done: false, promise: Promise.resolve() };

      created.promise = restore(projects.data ?? [], sessions.data ?? []).then(() => {
        created.done = true;
      });
      restorations.set(queryClient, created);
      restoration = created;
    }

    void restoration.promise.then(() => setReady(true));
  }, [ready, loaded, queryClient, projects.data, sessions.data]);

  return ready;
}
