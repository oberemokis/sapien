// Проект это папка на диске, где работает агент, как Project в Rust.
// missing: папки больше нет, сессии видны, но новый ответ не начнётся.
export type Project = { id: string; name: string; path: string; missing: boolean };

// Сессия это разговор с агентом в папке проекта, как SessionInfo в Rust.
// title пустой, пока человек ничего не написал. updated в миллисекундах.
// answering: агент сейчас отвечает в ней.
export type SessionInfo = {
  id: string;
  project: string;
  title: string;
  updated: number;
  answering: boolean;
};

// Сессии проекта, свежие сверху.
export function sessionsOf(sessions: SessionInfo[], project: string) {
  return sessions.filter((session) => session.project === project).toSorted((a, b) => b.updated - a.updated);
}

// Проект для новой сессии без явного выбора: проект открытой сессии,
// иначе последней, иначе первый в списке. Проект без папки не годится:
// сессию в нём Rust не заведёт. null: годных проектов нет.
export function homeProject(projects: Project[], sessions: SessionInfo[], selected: string | null) {
  const present = new Set(projects.filter((project) => !project.missing).map((project) => project.id));
  const usable = sessions.filter((session) => present.has(session.project));
  const open = usable.find((session) => session.id === selected);
  const recent = usable.toSorted((a, b) => b.updated - a.updated)[0];

  return open?.project ?? recent?.project ?? projects.find((project) => !project.missing)?.id ?? null;
}

export type FoundSession = SessionInfo & { projectName: string };

// Поиск сессии по названию и имени проекта: все слова запроса должны
// найтись. Пустой запрос даёт последние сессии.
export function searchSessions(sessions: SessionInfo[], projects: Project[], query: string, limit = 20): FoundSession[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const names = new Map(projects.map((project) => [project.id, project.name]));

  return sessions
    .map((session) => ({ ...session, projectName: names.get(session.project) ?? "" }))
    .filter((session) => {
      const haystack = `${session.title} ${session.projectName}`.toLowerCase();

      return words.every((word) => haystack.includes(word));
    })
    .toSorted((a, b) => b.updated - a.updated)
    .slice(0, limit);
}
