// Проект это папка на диске, где работает агент, как Project в Rust.
// missing: папки больше нет, сессии видны, но новый ответ не начнётся.
export type Project = { id: string; name: string; path: string; missing: boolean };

// Агенты, которых Rust узнаёт в терминале, как AGENTS в domain.rs.
export type Agent = "claude" | "codex" | "pi" | "opencode" | "gemini" | "cursor";

// Названия агентов: это имена программ, на язык окна они не переводятся.
export const AGENT_NAMES: Record<Agent, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  cursor: "Cursor",
};

// Интеграция агента в его настройках, как Integration в Rust. Она сообщает
// sapien разговор панели, и после перезапуска агент продолжает его.
// missing: агента на устройстве нет.
export type Integration = { agent: Agent; state: "missing" | "off" | "on" };

// Агент на переднем плане панели pane и работает ли он, как PaneAgent в Rust.
export type PaneAgent = { pane: string; agent: Agent; answering: boolean };

// Сессия это терминалы в папке проекта, как SessionInfo в Rust. title
// пустой, пока агент её не назвал. updated в миллисекундах. agents: кто
// сейчас запущен в её панелях, answering: хоть один из них работает.
export type SessionInfo = {
  id: string;
  project: string;
  title: string;
  updated: number;
  answering: boolean;
  agents: PaneAgent[];
};

// Порядок сессий в левой панели по проектам: его задают перетаскиванием.
// У проекта без записи сессии идут свежими сверху.
export type SessionOrder = Record<string, string[]>;

// Сессии проекта: сначала те, которых в порядке order нет, свежие сверху,
// за ними остальные в этом порядке. Так новая сессия встаёт наверх.
export function sessionsOf(sessions: SessionInfo[], project: string, order: string[] = []) {
  const own = sessions.filter((session) => session.project === project).toSorted((a, b) => b.updated - a.updated);
  const placed = own
    .filter((session) => order.includes(session.id))
    .toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return [...own.filter((session) => !order.includes(session.id)), ...placed];
}

// Порядок ids, в котором session встала перед before, а с null в конец.
export function moveSession(ids: string[], session: string, before: string | null) {
  const rest = ids.filter((id) => id !== session);
  let index = rest.length;

  if (before !== null) {
    index = rest.indexOf(before);
  }

  if (index === -1) {
    return ids;
  }

  return rest.toSpliced(index, 0, session);
}

// Порядок из хранилища окна: записи не того вида пропускаются.
export function parseSessionOrder(value: unknown): SessionOrder {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string"),
    ),
  );
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
