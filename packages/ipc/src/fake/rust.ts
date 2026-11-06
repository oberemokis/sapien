// Подделка Rust для окна без Tauri: тесты и pnpm dev:web. Отвечает на те же
// команды, что bindings.gen.ts, обработчик на каждую: новая команда без
// него не компилируется. Ответ приходит через setTimeout, как из процесса
// Rust: ответ микрозадачей прятал бы гонки с перерисовкой.
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  commands,
  type AppError,
  type Available,
  type ForgeStatus,
  type ForgeStatuses,
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
  forge: ForgeStatuses;
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
  // Обработчик команды вместо обычного. Обычный приходит вторым
  // аргументом: так обработчик дополняет его, а не пишет заново.
  handle<C extends Command>(command: C, handler: (next: Handler<C>) => Handler<C>): void;
  // Следующие times вызовов команды откажут error. Отказы встают
  // в очередь: так проверка сначала откажет одним кодом, потом другим.
  refuse(command: Command, error: AppError, times?: number): void;
};

const DEFAULT_STATE: FakeState = {
  version: "0.1.0",
  update: null,
  forge: { github: { kind: "none" }, gitlab: { kind: "none" } },
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
  const rust: FakeRust = {
    state: structuredClone({ ...DEFAULT_STATE, ...state }),
    // SAFETY: ключи это все команды из names, у каждой пустой список вызовов.
    calls: Object.fromEntries([...names.values()].map((command) => [command, []])) as unknown as FakeRust["calls"],
    plugins: [],
    handle: (command, handler) => {
      Object.assign(handlers, { [command]: handler(handlers[command]) });
    },
    refuse: (command, error, times = Infinity) => {
      refusals.set(command, [...(refusals.get(command) ?? []), { error, times }]);
    },
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
      // SAFETY: mockIPC ставит __TAURI_INTERNALS__ на window до первой команды.
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
