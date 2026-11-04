import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";
import {
  agentSessionDelete,
  agentSessionNew,
  agentSessionRename,
  agentSessions,
  onSessionsChanged,
  onTerminalExited,
  projectsAdd,
  projectsList,
  projectsRemove,
} from "../infrastructure/agent.api";
import {
  readCollapsed,
  readSessionOrder,
  readTabs,
  writeCollapsed,
  writeSessionOrder,
  writeTabs,
} from "../infrastructure/agent.device";
import { moveSession, sessionsOf, type SessionInfo } from "../model/sessions";
import { closeTab, moveTab, NO_TABS, openTab, pinTab, visibleTabs, type Tabs } from "../model/tabs";
import { collapsedStore, searchStore, sessionOrderStore, tabsStore } from "../store/sessions.store";
import { forgetPanes, sessionPanes } from "./panes";
import { closeTerminal, terminalExited } from "./terminal";

export const PROJECTS_KEY = ["agent", "projects"] as const;
export const SESSIONS_KEY = ["agent", "sessions"] as const;

tabsStore.setState(() => readTabs() ?? NO_TABS);
sessionOrderStore.setState(() => readSessionOrder());
collapsedStore.setState(() => readCollapsed());

// Сессии, у которых в левой панели свёрнута ветка агентов.
export function useCollapsed() {
  return useSelector(collapsedStore);
}

// Ветка агентов под сессией сворачивается или раскрывается.
export function toggleAgents(session: string) {
  collapsedStore.setState((sessions) => {
    if (sessions.includes(session)) {
      return sessions.filter((id) => id !== session);
    }

    return [...sessions, session];
  });
  writeCollapsed(collapsedStore.get());
}

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: projectsList });
}

export function useSessions() {
  return useQuery({ queryKey: SESSIONS_KEY, queryFn: agentSessions });
}

// Сессии проекта в левой панели, в порядке, который задал человек.
export function useProjectSessions(project: string) {
  const sessions = useSessions();
  const order = useSelector(sessionOrderStore, (all) => all[project]);

  return sessionsOf(sessions.data ?? [], project, order);
}

// Сессия встаёт в левой панели перед before, с null в конец. Запоминается
// весь порядок проекта, каким его видно: shown.
export function placeSession(project: string, shown: string[], session: string, before: string | null) {
  sessionOrderStore.setState((all) => ({ ...all, [project]: moveSession(shown, session, before) }));
  writeSessionOrder(sessionOrderStore.get());
}

// Открытый проект и его вкладки. Сессий, которых больше нет, вкладки не
// показывают.
export function useTabs() {
  const tabs = useSelector(tabsStore);
  const sessions = useSessions();

  return { project: tabs.project, ...visibleTabs(tabs, sessions.data ?? []) };
}

// Сессия активной вкладки. null: вкладок нет.
export function useActiveSession() {
  const { active } = useTabs();
  const sessions = useSessions();

  return sessions.data?.find((session) => session.id === active) ?? null;
}

function changeTabs(change: (tabs: Tabs) => Tabs) {
  tabsStore.setState(change);
  writeTabs(tabsStore.get());
}

// Сессия открывается вкладкой своего проекта, а окно переходит к вкладкам
// этого проекта.
export function openSession(session: Pick<SessionInfo, "id" | "project">) {
  changeTabs((tabs) => openTab(tabs, session.project, session.id));
}

// Закрытая вкладка закрывает и терминалы всех панелей сессии. Раскладка
// остаётся: открытая снова сессия получает те же панели.
export function closeSession(session: Pick<SessionInfo, "id" | "project">) {
  changeTabs((tabs) => closeTab(tabs, session.project, session.id));

  for (const pane of sessionPanes(session.id)) {
    closeTerminal(pane);
  }
}

export function pinSession(session: Pick<SessionInfo, "id" | "project">, pin: boolean) {
  changeTabs((tabs) => pinTab(tabs, session.project, session.id, pin));
}

// Вкладка сессии встаёт перед вкладкой before, с null в конец.
export function moveSessionTab(session: Pick<SessionInfo, "id" | "project">, before: string | null) {
  changeTabs((tabs) => moveTab(tabs, session.project, session.id, before));
}

// События Rust о сессиях и терминалах, пока смонтирована оболочка окна.
export function useAgentEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    const listeners = [onSessionsChanged(() => void refresh()), onTerminalExited(terminalExited)];

    return () => {
      for (const listener of listeners) {
        void listener.then((stop) => stop());
      }
    };
  }, [queryClient]);
}

export function useSearchOpen() {
  return useSelector(searchStore);
}

export function openSearch() {
  searchStore.setState(() => true);
}

export function closeSearch() {
  searchStore.setState(() => false);
}

// Новая сессия в проекте сразу открывается новой вкладкой.
export function useNewSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentSessionNew,
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      openSession(session);
    },
  });
}

// Новый проект начинается с пустой сессии в нём: за этим его и добавляют.
export function useAddProject() {
  const queryClient = useQueryClient();
  const newSession = useNewSession();

  return useMutation({
    mutationFn: projectsAdd,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });

      if (project !== null) {
        await newSession.mutateAsync(project.id);
      }
    },
  });
}

export function useRemoveProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: projectsRemove,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
      ]),
  });
}

// Имя сессии одно на вкладку и строку в левой панели.
export function useRenameSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => agentSessionRename(id, title),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}

// Удалённая сессия закрывает и свою вкладку, а её панели забываются.
export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (session: SessionInfo) => agentSessionDelete(session.id),
    onSuccess: (_, session) => {
      closeSession(session);
      forgetPanes(session.id);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}
