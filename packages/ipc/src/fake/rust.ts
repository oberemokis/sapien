// Подделка Rust для окна без Tauri: тесты и pnpm dev:web. Отвечает на те же
// команды, что bindings.gen.ts, обработчик на каждую: новая команда без
// него не компилируется. Ответ приходит через setTimeout, как из процесса
// Rust: ответ микрозадачей прятал бы гонки с перерисовкой.
import type { Channel } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  commands,
  type AppError,
  type Available,
  type ClaudeStatus,
  type ForgeStatus,
  type ForgeStatuses,
  type Integration,
  type Project,
  type SessionInfo,
} from "../index.ts";

type Commands = typeof commands;

export type Command = keyof Commands;

type Answer<C extends Command> = Awaited<ReturnType<Commands[C]>>;

export type Handler<C extends Command> = (...args: Parameters<Commands[C]>) => Answer<C> | Promise<Answer<C>>;

type Handlers = { [C in Command]: Handler<C> };

// Аргументы команд плагина событий, как их шлёт @tauri-apps/api/event.
type EventArgs = { event: string; handler?: number; eventId?: number; payload?: unknown };

// Связь с окном, которую ставит mockIPC: через неё приходят события.
type Internals = { runCallback(id: number, data: unknown): void };

// Что Rust хранит и отдаёт окну. Подделка меняет это так же, как Rust.
export type FakeState = {
  version: string;
  // Новая версия для app_update_check, null: новой нет.
  update: Available | null;
  projects: Project[];
  // Папка, которую человек выберет в системном диалоге. null: закрыл его.
  picked: Project | null;
  sessions: SessionInfo[];
  claude: ClaudeStatus;
  integrations: Integration[];
  forge: ForgeStatuses;
  // Прежние экраны панелей: первое сообщение terminal_open.
  screens: Record<string, string>;
};

export type FakeOptions = {
  state?: Partial<FakeState>;
  // Задержка ответа в миллисекундах. Даже 0 отвечает следующей задачей.
  delay?: number;
};

export type FakeRust = {
  state: FakeState;
  // Аргументы каждого вызова по командам, по порядку. Вызов попадает
  // сюда, когда Rust на него отвечает.
  calls: { [C in Command]: Parameters<Commands[C]>[] };
  // Команды плагинов Tauri, вроде масштаба страницы.
  plugins: { command: string; args: unknown }[];
  // Каналы вывода открытых панелей.
  terminals: Map<string, Channel<ArrayBuffer>>;
  // Обработчик команды вместо обычного. Обычный приходит вторым
  // аргументом: так обработчик дополняет его, а не пишет заново.
  handle<C extends Command>(command: C, handler: (next: Handler<C>) => Handler<C>): void;
  // Следующие times вызовов команды откажут error. Отказы встают
  // в очередь: так проверка сначала откажет одним кодом, потом другим.
  refuse(command: Command, error: AppError, times?: number): void;
  // Оболочка панели pane напечатала text.
  print(pane: string, text: string): void;
};

const DEFAULT_STATE: FakeState = {
  version: "0.1.0",
  update: null,
  projects: [],
  picked: null,
  sessions: [],
  claude: { state: "ready", version: "2.1.316" },
  integrations: [],
  forge: { github: { kind: "none" }, gitlab: { kind: "none" } },
  screens: {},
};

// appUpdateInstall в app_update_install: так их называет Rust.
function rustName(command: string) {
  return command.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function later(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function refused(code: string, kind: AppError["kind"]): AppError {
  return { kind, code };
}

export function fakeRust({ state = {}, delay = 0 }: FakeOptions = {}): FakeRust {
  const names = new Map(Object.keys(commands).map((command) => [rustName(command), command as Command]));
  const refusals = new Map<Command, { error: AppError; times: number }[]>();
  const encoder = new TextEncoder();
  const rust: FakeRust = {
    state: structuredClone({ ...DEFAULT_STATE, ...state }),
    calls: Object.fromEntries([...names.values()].map((command) => [command, []])) as unknown as FakeRust["calls"],
    plugins: [],
    terminals: new Map(),
    handle: (command, handler) => {
      Object.assign(handlers, { [command]: handler(handlers[command]) });
    },
    refuse: (command, error, times = Infinity) => {
      refusals.set(command, [...(refusals.get(command) ?? []), { error, times }]);
    },
    print: (pane, text) => {
      rust.terminals.get(pane)?.onmessage(encoder.encode(text).buffer);
    },
  };

  const toggle = (agent: string, next: Integration["state"]) => {
    rust.state.integrations = rust.state.integrations.map((found) => {
      if (found.agent !== agent) {
        return found;
      }

      return { ...found, state: next };
    });
    return null;
  };

  const handlers: Handlers = {
    openLink: () => null,
    appVersion: () => rust.state.version,
    appUpdateCheck: () => rust.state.update,
    // Половина загружена, дальше установка перезапускает приложение,
    // и ответа окно не дождётся.
    appUpdateInstall: (onEvent) => {
      setTimeout(() => onEvent.onmessage({ kind: "chunk", received: 512, total: 1024 }));
      return new Promise(() => {});
    },
    appUnlock: () => null,
    appSetLanguage: () => null,
    projectsList: () => rust.state.projects,
    projectsAdd: () => {
      const { picked } = rust.state;

      if (picked !== null) {
        rust.state.projects = [...rust.state.projects, picked];
      }

      return picked;
    },
    // Как remove_project: проект с работающим агентом не убрать.
    projectsRemove: (id) => {
      if (rust.state.sessions.some((found) => found.project === id && found.answering)) {
        throw refused("agent_busy", "conflict");
      }

      rust.state.projects = rust.state.projects.filter((project) => project.id !== id);
      rust.state.sessions = rust.state.sessions.filter((found) => found.project !== id);
      return null;
    },
    agentSessions: () => rust.state.sessions,
    agentSessionNew: (project) => {
      if (rust.state.projects.find((found) => found.id === project)?.missing !== false) {
        throw refused("project_missing", "not_found");
      }

      const created: SessionInfo = {
        id: `new${rust.calls.agentSessionNew.length}`,
        project,
        title: "",
        updated: Date.now(),
        answering: false,
        agents: [],
      };

      rust.state.sessions = [...rust.state.sessions, created];
      return created;
    },
    // Как delete_session: сессию с работающим агентом не удалить.
    agentSessionDelete: (id) => {
      if (rust.state.sessions.some((found) => found.id === id && found.answering)) {
        throw refused("agent_busy", "conflict");
      }

      rust.state.sessions = rust.state.sessions.filter((found) => found.id !== id);
      return null;
    },
    // Как rename_session: пробелы по краям не остаются.
    agentSessionRename: (id, title) => {
      rust.state.sessions = rust.state.sessions.map((found) => {
        if (found.id !== id) {
          return found;
        }

        return { ...found, title: title.trim() };
      });
      return null;
    },
    agentClaudeStatus: () => rust.state.claude,
    agentIntegrations: () => rust.state.integrations,
    agentIntegrationInstall: (agent) => toggle(agent, "on"),
    agentIntegrationRemove: (agent) => toggle(agent, "off"),
    // Первым сообщением, как в Rust, прежний экран панели, пусть и пустой.
    terminalOpen: (_session, pane, _cols, _rows, onData) => {
      rust.terminals.set(pane, onData);
      rust.print(pane, rust.state.screens[pane] ?? "");
      return null;
    },
    terminalStart: () => null,
    terminalWrite: () => null,
    terminalResize: () => null,
    terminalClose: (pane) => {
      rust.terminals.delete(pane);
      return null;
    },
    forgeStatus: () => rust.state.forge,
    // Токен проверяет сервер: «bad» он не принимает.
    forgeConnect: (forge, host, token) => {
      if (token.trim() === "") {
        throw refused("forge_token_empty", "invalid");
      }

      if (token === "bad") {
        throw refused("forge_token_rejected", "invalid");
      }

      const status: ForgeStatus = { kind: "connected", host: host ?? `${forge}.com`, login: "octocat" };

      rust.state.forge = { ...rust.state.forge, [forge]: status };
      return status;
    },
    forgeDisconnect: (forge) => {
      rust.state.forge = { ...rust.state.forge, [forge]: { kind: "none" } };
      return null;
    },
  };

  // Подписки окна на события. Свои, а не shouldMockEvents из mockIPC: та
  // ищет при отписке id вместо eventId и не снимает слушателя.
  const listeners = new Map<string, number[]>();

  const eventCommand = (command: string, args: EventArgs) => {
    const subscribed = listeners.get(args.event) ?? [];

    if (command === "plugin:event|listen" && args.handler !== undefined) {
      listeners.set(args.event, [...subscribed, args.handler]);
      return args.handler;
    }

    if (command === "plugin:event|unlisten") {
      listeners.set(
        args.event,
        subscribed.filter((id) => id !== args.eventId),
      );
    }

    if (command === "plugin:event|emit") {
      const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;

      for (const id of subscribed) {
        internals.runCallback(id, { event: args.event, id, payload: args.payload });
      }
    }

    return null;
  };

  mockIPC(async (command, payload) => {
    const name = names.get(command);

    if (command.startsWith("plugin:event|")) {
      return eventCommand(command, payload as EventArgs);
    }

    if (name === undefined) {
      if (command.startsWith("plugin:")) {
        rust.plugins.push({ command, args: payload });
        return null;
      }

      throw new Error(`подделка не знает команды ${command}`);
    }

    // Аргументы команды bindings.gen.ts кладёт в объект по порядку
    // параметров, поэтому их порядок и есть порядок значений.
    const args = Object.values(payload ?? {}) as never[];

    await later(delay);
    rust.calls[name].push(args as never);

    const queue = refusals.get(name) ?? [];
    const refusal = queue[0];

    if (refusal !== undefined) {
      refusal.times -= 1;

      if (refusal.times <= 0) {
        queue.shift();
      }

      throw refusal.error;
    }

    // Ответ уходит копией, как после сериализации в настоящем IPC.
    return structuredClone((await (handlers[name] as (...args: never[]) => unknown)(...args)) ?? null);
  });

  return rust;
}
