// Подделка Rust для pnpm dev:web: проекты, сессии и оболочка в терминале.
// Режимы задаёт хеш адреса через запятую, смена хеша требует перезагрузки:
//
//   #empty          проектов нет
//   #missing        папки проекта sapien нет на диске
//   #agents         в панелях работают Claude Code и Codex
//   #no-agents      ни Claude Code, ни других агентов на устройстве нет
//   #down           GitHub и GitLab не отвечают
//   #unlock-failed  первая проверка при разблокировке не проходит
//   #latest         новой версии нет, карточка обновления не закрывает угол
import type { Integration, Project, SessionInfo } from "../index.ts";
import { fakeRust } from "./rust.ts";
import { shell } from "./shell.ts";

const MINUTE = 60_000;

const NOTES =
  "## What's Changed\n* feat: приложение для работы с агентами by @oberemokis in https://github.com/oberemokis/sapien/pull/113";

function demoProjects(missing: boolean): Project[] {
  return [
    { id: "p1", name: "sapien", path: "/Users/me/Developer/sapien", missing },
    { id: "p2", name: "ad-tune", path: "/Users/me/Developer/ad-tune", missing: false },
  ];
}

function demoSessions(agents: boolean): SessionInfo[] {
  const now = Date.now();
  const session = (id: string, project: string, title: string, ago: number): SessionInfo => ({
    id,
    project,
    title,
    updated: now - ago * MINUTE,
    answering: false,
    agents: [],
  });
  const sessions = [
    session("s1", "p1", "Почини падающий тест в chat.spec", 5),
    session("s2", "p1", "Добавь интеграцию с GitLab", 3 * 60),
    session("s3", "p2", "Разберись, почему сборка медленная", 26 * 60),
  ];

  if (agents) {
    sessions[0] = { ...sessions[0], answering: true, agents: [{ pane: "s1", agent: "claude", answering: true }] };
    sessions[2] = { ...sessions[2], agents: [{ pane: "s3", agent: "codex", answering: false }] };
  }

  return sessions;
}

// Агенты на устройстве: без них интеграции ставить некуда.
function demoIntegrations(absent: boolean): Integration[] {
  const found = (agent: string, state: Integration["state"]): Integration => {
    if (absent) {
      return { agent, state: "missing" };
    }

    return { agent, state };
  };

  return [found("claude", "on"), found("codex", "off"), found("pi", "missing"), found("opencode", "off"), found("cursor", "missing")];
}

export function browserRust(hash: string) {
  const modes = new Set(hash.replace(/^#/, "").split(","));
  const rust = fakeRust({
    delay: 20,
    state: {
      update: { version: "0.2.0", notes: NOTES },
      projects: demoProjects(modes.has("missing")),
      picked: { id: "p3", name: "landing", path: "/Users/me/Developer/landing", missing: false },
      sessions: demoSessions(modes.has("agents")),
      integrations: demoIntegrations(modes.has("no-agents")),
    },
  });

  shell(rust);

  if (modes.has("empty")) {
    rust.state.projects = [];
    rust.state.sessions = [];
  }

  if (modes.has("no-agents")) {
    rust.state.claude = { state: "missing", version: null };
  }

  if (modes.has("latest")) {
    rust.state.update = null;
  }

  if (modes.has("down")) {
    rust.refuse("forgeConnect", { kind: "unavailable", code: "forge_unreachable" });
  }

  if (modes.has("unlock-failed")) {
    rust.refuse("appUnlock", { kind: "invalid", code: "unlock_failed" }, 1);
  }

  return rust;
}
