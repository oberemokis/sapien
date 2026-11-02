import type { SessionInfo } from "./sessions";

// Вкладки одного проекта: открытые сессии по порядку и активная среди них.
type ProjectTabs = { sessions: string[]; active: string | null };

// Вкладки окна. У каждого проекта свой набор, а видны вкладки одного:
// открытого, project. Ответы идут во всех вкладках сразу.
export type Tabs = { project: string | null; projects: Record<string, ProjectTabs> };

export const NO_TABS: Tabs = { project: null, projects: {} };

const EMPTY: ProjectTabs = { sessions: [], active: null };

function isProjectTabs(value: unknown): value is ProjectTabs {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessions" in value &&
    Array.isArray(value.sessions) &&
    value.sessions.every((id) => typeof id === "string") &&
    "active" in value &&
    (value.active === null || typeof value.active === "string")
  );
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

  const entries = Object.entries(projects);
  const valid = entries.filter((entry): entry is [string, ProjectTabs] => isProjectTabs(entry[1]));

  if (valid.length !== entries.length) {
    return null;
  }

  return { project, projects: Object.fromEntries(valid) };
}

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

// Разговор терминала перешёл в другую сессию, например после /clear:
// вкладка остаётся на месте, но теперь это вкладка сессии to. Вкладка to,
// если была, уходит, чтобы не было двух.
export function replaceTab(tabs: Tabs, from: string, to: string): Tabs {
  const projects = Object.entries(tabs.projects).map(([project, current]): [string, ProjectTabs] => {
    const kept = current.sessions.filter((id) => id !== to);
    const index = kept.indexOf(from);
    let { active } = current;

    if (index === -1) {
      return [project, current];
    }

    if (active === from) {
      active = to;
    }

    return [project, { sessions: kept.with(index, to), active }];
  });

  return { ...tabs, projects: Object.fromEntries(projects) };
}
