// Оболочка в терминале подделки для pnpm dev:web. Печатает приглашение
// и эхо, имя агента запускает его в панели, Enter в агенте даёт ему
// поработать две секунды, exit возвращает в оболочку.
import { events, type PaneAgent } from "../index.ts";
import type { FakeRust } from "./rust.ts";

const AGENTS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  cursor: "Cursor",
};

const ANSWER_MS = 2000;

export function shell(rust: FakeRust) {
  const lines = new Map<string, string>();
  const owner = new Map<string, string>();

  const sessionOf = (pane: string) => rust.state.sessions.find((found) => found.id === owner.get(pane));
  const agentOf = (pane: string) => sessionOf(pane)?.agents.find((found) => found.pane === pane);

  const prompt = (pane: string) => {
    const project = rust.state.projects.find((found) => found.id === sessionOf(pane)?.project);

    rust.print(pane, `\x1b[1;36m~/Developer/${project?.name ?? ""}\x1b[0m \x1b[1;35m❯\x1b[0m `);
  };

  const banner = (pane: string, agent: string) => {
    rust.print(pane, `\x1b[38;5;174m✻\x1b[0m Welcome to \x1b[1m${AGENTS[agent]}\x1b[0m\r\n\r\n\x1b[2m>\x1b[0m `);
  };

  // Агент панели меняется в самой сессии, как его видит Rust, и окно
  // узнаёт об этом событием. null: агент вышел.
  const setAgent = (pane: string, agent: PaneAgent | null, title?: string) => {
    const id = owner.get(pane);

    rust.state.sessions = rust.state.sessions.map((found) => {
      if (found.id !== id) {
        return found;
      }

      const agents = found.agents.filter((running) => running.pane !== pane);

      if (agent !== null) {
        agents.push(agent);
      }

      return {
        ...found,
        title: found.title || (title ?? ""),
        agents,
        answering: agents.some((running) => running.answering),
      };
    });
    void events.agentSessions.emit();
  };

  // Агент называет сессию первым заданием, как Claude Code.
  const answer = (pane: string, agent: string, text: string) => {
    setAgent(pane, { pane, agent, answering: true }, text.slice(0, 60));
    rust.print(pane, "\x1b[38;5;174m✻\x1b[0m \x1b[2mThinking…\x1b[0m\r\n");
    setTimeout(() => {
      rust.print(pane, `\x1b[1m⏺\x1b[0m Готово: «${text}». Тесты проходят.\r\n\r\n\x1b[2m>\x1b[0m `);
      setAgent(pane, { pane, agent, answering: false });
    }, ANSWER_MS);
  };

  const enter = (pane: string, line: string) => {
    const running = agentOf(pane);

    rust.print(pane, "\r\n");

    if (running !== undefined && line === "exit") {
      setAgent(pane, null);
      prompt(pane);
    } else if (running !== undefined) {
      answer(pane, running.agent, line);
    } else if (line in AGENTS) {
      setAgent(pane, { pane, agent: line, answering: false });
      banner(pane, line);
    } else {
      if (line !== "") {
        rust.print(pane, `zsh: command not found: ${line}\r\n`);
      }

      prompt(pane);
    }
  };

  rust.handle("terminalOpen", (open) => (session, pane, cols, rows, onData) => {
    owner.set(pane, session);
    setTimeout(() => {
      const running = agentOf(pane);

      if (running === undefined) {
        prompt(pane);
      } else {
        banner(pane, running.agent);
      }
    });
    return open(session, pane, cols, rows, onData);
  });

  rust.handle("terminalWrite", (write) => (pane, data) => {
    for (const char of data) {
      const line = lines.get(pane) ?? "";

      if (char === "\r") {
        lines.set(pane, "");
        enter(pane, line.trim());
      } else if (char === "\x7f") {
        if (line !== "") {
          lines.set(pane, [...line].slice(0, -1).join(""));
          rust.print(pane, "\b \b");
        }
      } else {
        lines.set(pane, line + char);
        rust.print(pane, char);
      }
    }

    return write(pane, data);
  });
}
