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
import { readSession, writeSession } from "../infrastructure/agent.device";
import { searchStore, sessionStore } from "../store/chat.store";

export const PROJECTS_KEY = ["agent", "projects"] as const;
export const SESSIONS_KEY = ["agent", "sessions"] as const;

sessionStore.setState(() => readSession());

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: projectsList });
}

export function useSessions() {
  return useQuery({ queryKey: SESSIONS_KEY, queryFn: agentSessions });
}

// Открытая сессия. Сессию, которой больше нет, окно не показывает.
export function useSelectedSession() {
  const selected = useSelector(sessionStore);
  const sessions = useSessions();

  if (sessions.data !== undefined && !sessions.data.some((session) => session.id === selected)) {
    return null;
  }

  return selected;
}

export function selectSession(session: string | null) {
  sessionStore.setState(() => session);
  writeSession(session);
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

// Новая сессия в проекте сразу открывается.
export function useNewSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentSessionNew,
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      selectSession(session.id);
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

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: agentSessionDelete,
    onSettled: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}
