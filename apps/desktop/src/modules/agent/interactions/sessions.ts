import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import {
  agentSessionDelete,
  agentSessionNew,
  agentSessions,
  projectsAdd,
  projectsList,
  projectsRemove,
} from "../infrastructure/agent.api";
import { readTabs, writeTabs } from "../infrastructure/agent.device";
import type { SessionInfo } from "../model/sessions";
import { closeTab, NO_TABS, openTab, visibleTabs, type Tabs } from "../model/tabs";
import { searchStore, tabsStore } from "../store/sessions.store";

export const PROJECTS_KEY = ["agent", "projects"] as const;
export const SESSIONS_KEY = ["agent", "sessions"] as const;

tabsStore.setState(() => readTabs() ?? NO_TABS);

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: projectsList });
}

export function useSessions() {
  return useQuery({ queryKey: SESSIONS_KEY, queryFn: agentSessions });
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

export function closeSession(session: Pick<SessionInfo, "id" | "project">) {
  changeTabs((tabs) => closeTab(tabs, session.project, session.id));
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

// Удалённая сессия закрывает и свою вкладку.
export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (session: SessionInfo) => agentSessionDelete(session.id),
    onSuccess: (_, session) => closeSession(session),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}
