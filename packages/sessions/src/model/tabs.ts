import type { SessionInfo } from "@sapien/ipc";
import { isIds } from "./sessions";

// Вкладки одного проекта: открытые сессии по порядку и активная среди них.
// pinned: закреплённые, они всегда стоят левее остальных.
type ProjectTabs = { sessions: string[]; active: string | null; pinned: string[] };

// Вкладки окна. У каждого проекта свой набор, а видны вкладки одного:
// открытого, project. Ответы идут во всех вкладках сразу.
export type Tabs = { project: string | null; projects: Record<string, ProjectTabs> };

export const NO_TABS: Tabs = { project: null, projects: {} };

const EMPTY: ProjectTabs = { sessions: [], active: null, pinned: [] };

// Вкладки проекта из хранилища. В версиях до закрепления списка
// закреплённых нет. Закреплённые ставятся левее остальных.
function projectTabs(value: unknown): ProjectTabs | null {
  if (typeof value !== "object" || value === null || !("sessions" in value) || !("active" in value)) {
    return null;
  }

  const { sessions, active } = value;
  let pinned: unknown = [];

  if ("pinned" in value) {
    ({ pinned } = value);
  }

  if (!isIds(sessions) || !isIds(pinned) || (active !== null && typeof active !== "string")) {
    return null;
  }

  const kept = pinned.filter((id) => sessions.includes(id));

  return { sessions: [...kept, ...sessions.filter((id) => !kept.includes(id))], active, pinned: kept };
}

// Вкладки из хранилища окна: там может лежать что угодно от прошлых
// версий. null: вкладок не было или это не вкладки.
export function parseTabs(value: unknown): Tabs | null {
  if (typeof value !== "object" || value === null || !("project" in value) || !("projects" in value)) {
    return null;
  }

  const { project, projects } = value;

  if ((project !== null && typeof project !== "string") || typeof projects !== "object" || projects === null) {
    return null;
  }

  const entries = Object.entries(projects).map(([id, tabs]) => [id, projectTabs(tabs)] as const);
  const valid = entries.filter((entry): entry is [string, ProjectTabs] => entry[1] !== null);

  if (valid.length !== entries.length) {
    return null;
  }

  return { project, projects: Object.fromEntries(valid) };
}

function changeProject(tabs: Tabs, project: string, change: (current: ProjectTabs) => ProjectTabs): Tabs {
  return { ...tabs, projects: { ...tabs.projects, [project]: change(tabs.projects[project] ?? EMPTY) } };
}

// Сессия становится активной вкладкой своего проекта, а проект открытым.
// Открытая сессия второй вкладки не получает.
export function openTab(tabs: Tabs, project: string, session: string): Tabs {
  const next = changeProject(tabs, project, (current) => {
    let { sessions } = current;

    if (!sessions.includes(session)) {
      sessions = [...sessions, session];
    }

    return { ...current, sessions, active: session };
  });

  return { ...next, project };
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
  const pinned = current.pinned.filter((id) => id !== session);
  let active = current.active;

  if (active === session) {
    active = sessions[Math.min(index, sessions.length - 1)] ?? null;
  }

  return changeProject(tabs, project, () => ({ sessions, active, pinned }));
}

// Вкладка session встаёт перед вкладкой before, а с null в конец. Закреплённая
// остаётся среди закреплённых, остальные правее них.
export function moveTab(tabs: Tabs, project: string, session: string, before: string | null): Tabs {
  const current = tabs.projects[project];

  if (current === undefined || !current.sessions.includes(session)) {
    return tabs;
  }

  const rest = current.sessions.filter((id) => id !== session);
  const pinned = rest.filter((id) => current.pinned.includes(id)).length;
  let index = rest.length;

  if (before !== null) {
    index = rest.indexOf(before);
  }

  if (index === -1) {
    return tabs;
  }

  if (current.pinned.includes(session)) {
    index = Math.min(index, pinned);
  } else {
    index = Math.max(index, pinned);
  }

  return changeProject(tabs, project, () => ({ ...current, sessions: rest.toSpliced(index, 0, session) }));
}

// Закреплённая вкладка встаёт последней среди закреплённых, а открепленная
// первой среди остальных.
export function pinTab(tabs: Tabs, project: string, session: string, pin: boolean): Tabs {
  const current = tabs.projects[project];

  if (current === undefined || !current.sessions.includes(session)) {
    return tabs;
  }

  const others = current.pinned.filter((id) => id !== session);
  const rest = current.sessions.filter((id) => id !== session);
  let pinned = others;

  if (pin) {
    pinned = [...others, session];
  }

  const sessions = rest.toSpliced(others.length, 0, session);

  return changeProject(tabs, project, () => ({ ...current, sessions, pinned }));
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

  return { sessions: open, active, pinned: current.pinned.filter((id) => known.has(id)) };
}
