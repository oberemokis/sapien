import type { SessionInfo } from "./sessions";

// Вкладки одного проекта: открытые сессии по порядку и активная среди них.
export type ProjectTabs = { sessions: string[]; active: string | null };

// Вкладки окна. У каждого проекта свой набор, а видны вкладки одного:
// открытого, project. Ответы идут во всех вкладках сразу.
export type Tabs = { project: string | null; projects: Record<string, ProjectTabs> };

export const NO_TABS: Tabs = { project: null, projects: {} };

const EMPTY: ProjectTabs = { sessions: [], active: null };

// Сессия становится активной вкладкой своего проекта, а проект открытым.
// Открытая сессия второй вкладки не получает.
export function openTab(tabs: Tabs, project: string, session: string): Tabs {
  const { sessions } = tabs.projects[project] ?? EMPTY;
  let next = sessions;

  if (!sessions.includes(session)) {
    next = [...sessions, session];
  }

  return { project, projects: { ...tabs.projects, [project]: { sessions: next, active: session } } };
}

// Закрытая активная вкладка отдаёт место соседней справа, а крайняя
// правая соседней слева.
export function closeTab(tabs: Tabs, project: string, session: string): Tabs {
  const current = tabs.projects[project];
  const index = current?.sessions.indexOf(session) ?? -1;

  if (current === undefined || index === -1) {
    return tabs;
  }

  const sessions = current.sessions.toSpliced(index, 1);
  let active = current.active;

  if (active === session) {
    active = sessions[Math.min(index, sessions.length - 1)] ?? null;
  }

  return { ...tabs, projects: { ...tabs.projects, [project]: { sessions, active } } };
}

// Вкладки открытого проекта, только сессий, которые ещё есть: удалённая
// сессия уходит и из вкладок. Без активной активна последняя.
export function visibleTabs(tabs: Tabs, sessions: SessionInfo[]): ProjectTabs {
  const known = new Set(sessions.filter((session) => session.project === tabs.project).map((session) => session.id));
  const current = tabs.projects[tabs.project ?? ""] ?? EMPTY;
  const open = current.sessions.filter((id) => known.has(id));
  let active = current.active;

  if (active === null || !open.includes(active)) {
    active = open.at(-1) ?? null;
  }

  return { sessions: open, active };
}
