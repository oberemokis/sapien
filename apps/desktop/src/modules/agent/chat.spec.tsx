import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import type { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionList, SessionSearch, SessionTabs, SessionView, useActionTriggers, useAttach } from "@/modules/agent";
import type { Provider } from "./model/agents";
import type { Answer, ChatEntry, ChatEvent, ClaudeStatus, Oversight, Question } from "./model/chat";
import type { Project, SessionInfo } from "./model/sessions";
import { NO_TABS } from "./model/tabs";
import { chatStore, draftStore, searchStore, tabsStore } from "./store/chat.store";
import { choiceStore } from "./store/choice.store";

type Sent = {
  session: string;
  provider: string;
  model: string | null;
  effort: string | null;
  text: string;
  oversight: Oversight;
};

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

const ALL_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// Claude Code со своими моделями: окно показывает все, что он назвал.
const CLAUDE: Provider = {
  id: "claude",
  name: "Claude Code",
  models: [
    { id: "sonnet", resolved: "claude-sonnet-5-5", name: "Sonnet 5.5", description: "Для повседневных задач", efforts: ALL_EFFORTS },
    { id: "opus", resolved: "claude-opus-5-5", name: "Opus 5.5", description: "Для сложных задач", efforts: ALL_EFFORTS },
    { id: "haiku", resolved: "claude-haiku-5-5", name: "Haiku 5.5", description: "Самая быстрая", efforts: [] },
  ],
};

// Второй агент на устройстве.
const CODEX: Provider = {
  id: "codex",
  name: "Codex",
  models: [{ id: "gpt-5", resolved: null, name: "GPT-5", description: "", efforts: [] }],
};

// Сессия, которая ещё не отвечала: выбора агента в ней нет. Начатой её
// делает история в подделке Rust.
const FRESH = { provider: "claude", model: null, effort: null, started: false };

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };
// Кавычка в пути: команда для терминала должна её экранировать.
const SITE: Project = { id: "p2", name: "сайт", path: "/Users/me/O'Brien/сайт", missing: false };
// Папка, которую человек выберет в системном диалоге «Добавить проект».
const DOCS: Project = { id: "p3", name: "документы", path: "/Users/me/документы", missing: false };

const SESSIONS: SessionInfo[] = [
  { id: "s1", project: "p1", title: "Рефакторинг парсера", updated: 3000, ...FRESH },
  { id: "s2", project: "p1", title: "Тесты окна", updated: 5000, ...FRESH },
  { id: "s3", project: "p2", title: "Лендинг", updated: 4000, ...FRESH },
];

// happy-dom представляется Linux, но тест не должен от этого зависеть.
const MOD = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };

// Сообщение в канал так, как его шлёт Rust. Каналы mockIPC держит здесь.
function toChannel(channel: Channel<ChatEvent>, index: number, message: ChatEvent) {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } })
    .__TAURI_INTERNALS__;

  internals.runCallback(channel.id, { index, message });
}

// Ответ одной сессии: события в её канал, конец и отказ.
type Run = {
  emit: (event: ChatEvent) => void;
  finish: (answer: ChatEntry[]) => void;
  fail: (code: string) => void;
};

// Rust за командами агента: агенты на устройстве, проекты, их сессии,
// история каждой сессии и ответы, которые идут событиями через канал
// и кончаются, когда тест их отпустит. Ответы разных сессий идут
// параллельно. ongoing это ответ в первой сессии, который уже идёт и ждёт
// ответа на вопрос, когда окно открывается: так выглядит перезагрузка окна.
function fakeRust({
  projects = [SAPIEN, SITE],
  claude = READY,
  ongoing = null,
  providers = [CLAUDE],
}: { projects?: Project[]; claude?: ClaudeStatus; ongoing?: Question | null; providers?: Provider[] } = {}) {
  const rust = {
    projects: [...projects],
    sessions: SESSIONS.filter((session) => projects.some((project) => project.id === session.project)),
    history: {} as Record<string, ChatEntry[]>,
    // Сессии, которые Rust начал по просьбе окна.
    created: [] as SessionInfo[],
    removed: [] as string[],
    deleted: [] as string[],
    // Сессии, по которым Rust считает ответ идущим, хотя окно его не видит.
    busy: [] as string[],
    sent: [] as Sent[],
    answers: [] as { session: string; id: string; answer: Answer }[],
    stops: [] as string[],
    // Ответы по сессиям. emit, finish и fail ниже ведут последний начатый.
    runs: {} as Record<string, Run>,
    emit: (_event: ChatEvent) => {},
    finish: (_answer: ChatEntry[]) => {},
    fail: (_code: string) => {},
  };

  // Ответ сессии начался: события идут в её канал, а в конце строки
  // ответа ложатся в историю.
  function start(session: string, onEvent: Channel<ChatEvent>, resolve: () => void, reject: (code: string) => void) {
    let index = 0;
    const run: Run = {
      emit: (event) => {
        toChannel(onEvent, index, event);
        index += 1;
      },
      finish: (entries) => {
        rust.history[session] = [...(rust.history[session] ?? []), ...entries];
        resolve();
      },
      fail: reject,
    };

    rust.runs[session] = run;
    rust.emit = run.emit;
    rust.finish = run.finish;
    rust.fail = run.fail;

    return run;
  }

  mockIPC((command, args) => {
    switch (command) {
      case "projects_list":
        return rust.projects;
      case "projects_add":
        rust.projects = [...rust.projects, DOCS];
        return DOCS;
      case "projects_remove": {
        const { id } = args as { id: string };

        rust.removed.push(id);
        rust.projects = rust.projects.filter((project) => project.id !== id);
        rust.sessions = rust.sessions.filter((session) => session.project !== id);
        return null;
      }
      // Как has_messages в domain.rs: сессия с историей начата.
      case "agent_sessions":
        return rust.sessions.map((session) => ({
          ...session,
          started: session.started || (rust.history[session.id]?.length ?? 0) > 0,
        }));
      case "agent_session_delete": {
        const { id } = args as { id: string };

        // Как delete_session в use_case.rs: по сессии идёт ответ, отказ.
        if (rust.busy.includes(id)) {
          throw { kind: "conflict", code: "agent_busy" };
        }

        rust.deleted.push(id);
        rust.sessions = rust.sessions.filter((session) => session.id !== id);
        return null;
      }
      case "agent_session_new": {
        const { project } = args as { project: string };

        if (rust.projects.find((candidate) => candidate.id === project)?.missing !== false) {
          throw { kind: "not_found", code: "project_missing" };
        }

        const session: SessionInfo = { id: `new${rust.created.length + 1}`, project, title: "", updated: 10_000, ...FRESH };

        rust.created.push(session);
        rust.sessions = [...rust.sessions, session];
        return session;
      }
      case "agent_history":
        return rust.history[(args as { session: string }).session] ?? [];
      case "agent_claude_status":
        return claude;
      case "agent_providers":
        return providers;
      case "agent_commands":
        return { commands: [] };
      case "actions_list":
        return [];
      case "agent_running":
        return ongoing === null ? [] : ["s1"];
      case "agent_attach": {
        const { session, onEvent } = args as { session: string; onEvent: Channel<ChatEvent> };

        if (ongoing === null || session !== "s1") {
          return false;
        }

        return new Promise((resolve) => {
          start(session, onEvent, () => resolve(true), () => resolve(true)).emit({ kind: "asked", question: ongoing });
        });
      }
      case "agent_answer":
        rust.answers.push(args as { session: string; id: string; answer: Answer });
        return null;
      case "agent_stop":
        rust.stops.push((args as { session: string }).session);
        return null;
      case "agent_send": {
        const { onEvent, ...sent } = args as Sent & { onEvent: Channel<ChatEvent> };

        rust.sent.push(sent);
        // Название пустой сессии Rust берёт из первой строки сообщения,
        // а выбор агента запоминает с каждым сообщением.
        rust.sessions = rust.sessions.map((session) => {
          if (session.id !== sent.session) {
            return session;
          }

          const { provider, model, effort } = sent;

          // Как title в domain.rs: первая строка без пробелов по краям.
          // Непустое сообщение ложится в историю, и разговор начат.
          const title = session.title || (sent.text.trim().split("\n")[0]?.trim() ?? "");
          const started = session.started || sent.text.trim() !== "";

          return { ...session, provider, model, effort, title, started };
        });

        return new Promise((resolve, reject) => {
          start(sent.session, onEvent, () => resolve(null), (code) => reject({ kind: "invalid", code }));
        });
      }
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return rust;
}

// Оболочка окна, как pages/_shell.tsx: слева панель сессий, сверху вкладки,
// посередине активная вкладка, поверх поиск.
function Shell() {
  const navigate = useNavigate();
  const showChat = useCallback(() => void navigate({ to: "/" }), [navigate]);
  const { deferred } = useActionTriggers({ onRun: showChat });

  return (
    <>
      <header>
        <SessionTabs />
      </header>
      <aside>
        <SessionList deferred={deferred} />
      </aside>
      <main>
        <Outlet />
      </main>
      <SessionSearch />
    </>
  );
}

// Окно открылось заново. useAttach подключается один раз за жизнь модуля,
// как за жизнь окна, поэтому в этом файле его зовёт только один тест.
function Reopened() {
  useAttach();

  return <Shell />;
}

// client: кеш запросов окна, по умолчанию обычный.
function open({ reopened = false, client = new QueryClient() } = {}) {
  const root = createRootRoute({ component: reopened ? Reopened : Shell });
  const chat = createRoute({ getParentRoute: () => root, path: "/", component: SessionView });
  const router = createRouter({
    routeTree: root.addChildren([chat]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// Даёт окну время сделать то, чего делать не должно.
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function panel() {
  return within(screen.getByRole("navigation", { name: "Сессии" }));
}

// Названия сессий проекта в левой панели сверху вниз.
function sessionTitles(project: string) {
  const item = panel().getByText(project).closest("li");

  if (item === null) {
    throw new Error(`нет проекта ${project}`);
  }

  return within(item)
    .queryAllByRole("listitem")
    .map((row) => row.querySelector("span")?.textContent);
}

// Отметка идущего ответа у сессии в левой панели.
function isRunning(title: string) {
  const row = panel().getByText(title).closest("button");

  return row !== null && within(row).queryByText("агент отвечает") !== null;
}

// Сессию открывают в левой панели. Имя строки начинается с названия,
// за ним может стоять отметка идущего ответа.
async function openSession(title: string) {
  await waitFor(() => panel().getByText(title));
  fireEvent.click(panel().getByRole("button", { name: (name) => name.startsWith(title) }));
  await waitFor(() => expect(opened()?.startsWith(title)).toBe(true));
}

// Открытая сессия отмечена в левой панели.
function opened() {
  return panel().queryByRole("button", { current: "page" })?.textContent ?? null;
}

const TAB_STRIP = { name: /^Вкладки проекта/ };

// Вкладки открытого проекта слева направо, у активной звёздочка. Первая
// кнопка вкладки открывает её, вторая закрывает.
function tabs() {
  const strip = screen.queryByRole("navigation", TAB_STRIP);

  return (strip === null ? [] : within(strip).queryAllByRole("listitem")).map((item) => {
    const [show] = within(item).getAllByRole("button");

    return `${show?.title}${show?.getAttribute("aria-current") === "page" ? "*" : ""}`;
  });
}

function tab(name: string | RegExp) {
  return within(screen.getByRole("navigation", TAB_STRIP)).getByRole("button", { name });
}

function closeTab(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Закрыть вкладку «${title}»` }));
}

function field() {
  return screen.getByLabelText<HTMLTextAreaElement>("Сообщение агенту");
}

function sendButton() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Отправить" });
}

async function ask(text: string) {
  fireEvent.change(await screen.findByLabelText("Сообщение агенту"), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

// Окно в каждом тесте новое: то, что живёт с окном, начинается заново.
afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
  chatStore.setState(() => ({ runs: {}, problems: {}, askEdits: true }));
  tabsStore.setState(() => NO_TABS);
  draftStore.setState(() => ({}));
  searchStore.setState(() => false);
  choiceStore.setState(() => ({ last: null, sessions: {} }));
});

describe("левая панель", () => {
  it("проекты показывают свои сессии свежими сверху, идущий ответ отмечен у своей сессии", async () => {
    const rust = fakeRust();
    open();
    await waitFor(() => expect(sessionTitles("sapien")).toEqual(["Тесты окна", "Рефакторинг парсера"]));
    expect(sessionTitles("сайт")).toEqual(["Лендинг"]);

    await openSession("Рефакторинг парсера");
    await ask("Почини парсер");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    expect(isRunning("Рефакторинг парсера")).toBe(true);
    expect(isRunning("Тесты окна")).toBe(false);
    rust.finish([]);
    await waitFor(() => expect(isRunning("Рефакторинг парсера")).toBe(false));
  });

  it("«+» во вкладках начинает сессию в открытом проекте новой вкладкой, название встаёт по первому сообщению", async () => {
    const rust = fakeRust();
    open();
    await openSession("Лендинг");
    expect(panel().queryByRole("button", { name: /^Новая сессия в/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Новая сессия в «сайт»" }));

    await waitFor(() => expect(opened()).toBe("Новая сессия"));
    expect(rust.created.map((session) => session.project)).toEqual(["p2"]);
    expect(sessionTitles("сайт")).toEqual(["Новая сессия", "Лендинг"]);
    expect(tabs()).toEqual(["Лендинг", "Новая сессия*"]);
    // Пустая сессия без ленты: поле ввода стоит посередине.
    await screen.findByLabelText("Сообщение агенту");
    expect(screen.queryByRole("log")).toBeNull();

    await ask("\n  Сверстай шапку\nи подвал");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]?.session).toBe(rust.created[0]?.id);
    // Название видно сразу, ответ ещё идёт, лента над полем.
    expect(sessionTitles("сайт")).toEqual(["Сверстай шапку", "Лендинг"]);
    expect(opened()).toMatch(/^Сверстай шапку/);
    expect(screen.getByRole("log", { name: "Чат с агентом" })).toBeDefined();

    // Rust записал то же название: после ответа оно не меняется.
    rust.finish([]);
    await waitFor(() => expect(opened()).toBe("Сверстай шапку"));
    expect(sessionTitles("сайт")).toEqual(["Сверстай шапку", "Лендинг"]);
  });

  it("«Добавить проект» заводит проект и сразу открывает сессию в нём", async () => {
    const rust = fakeRust();
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Добавить проект" }));

    await waitFor(() => expect(opened()).toBe("Новая сессия"));
    expect(rust.created.map((session) => session.project)).toEqual(["p3"]);
    expect(sessionTitles("документы")).toEqual(["Новая сессия"]);
    expect(tabs()).toEqual(["Новая сессия*"]);
  });

  it("«Убрать проект» сначала спрашивает, потом убирает проект с его сессиями", async () => {
    const rust = fakeRust();
    open();
    await waitFor(() => expect(sessionTitles("сайт")).toEqual(["Лендинг"]));

    fireEvent.contextMenu(panel().getByText("сайт"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Убрать проект" }));
    const question = screen.getByRole("alert");
    expect(question.textContent).toContain("Его сессии удалятся, папка на диске останется.");
    fireEvent.click(within(question).getByRole("button", { name: "Отмена" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(rust.removed).toEqual([]);

    fireEvent.contextMenu(panel().getByText("сайт"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Убрать проект" }));
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Убрать" }));

    await waitFor(() => expect(panel().queryByText("сайт")).toBeNull());
    expect(panel().queryByText("Лендинг")).toBeNull();
    expect(rust.removed).toEqual(["p2"]);
  });

  it("сессию с идущим ответом удалить нельзя, отказ Rust виден, остальные удаляются", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Почини парсер");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    fireEvent.contextMenu(panel().getByText("Рефакторинг парсера"));
    const item = screen.getByRole<HTMLButtonElement>("menuitem", { name: /^Удалить сессию/ });
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain("агент отвечает");

    rust.finish([]);
    await waitFor(() => expect(isRunning("Рефакторинг парсера")).toBe(false));

    rust.busy.push("s2");
    fireEvent.contextMenu(panel().getByText("Тесты окна"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить сессию" }));
    expect(await screen.findByText("Сессия не удалилась.")).toBeDefined();
    expect(sessionTitles("sapien")).toEqual(["Тесты окна", "Рефакторинг парсера"]);

    fireEvent.contextMenu(panel().getByText("Рефакторинг парсера"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить сессию" }));
    await waitFor(() => expect(sessionTitles("sapien")).toEqual(["Тесты окна"]));
    expect(rust.deleted).toEqual(["s1"]);
    expect(screen.queryByText("Сессия не удалилась.")).toBeNull();
  });

  it("новая сессия, которую Rust не завёл, говорит об этом во вкладках и в меню проекта", async () => {
    const rust = fakeRust();
    open();
    await openSession("Лендинг");
    // Папку проекта убрали с диска, а окно об этом ещё не знает.
    rust.projects = rust.projects.map((project) => (project.id === "p2" ? { ...project, missing: true } : project));

    fireEvent.click(screen.getByRole("button", { name: "Новая сессия в «сайт»" }));
    expect(await within(screen.getByRole("navigation", TAB_STRIP)).findByText("Сессия не создалась.")).toBeDefined();

    fireEvent.contextMenu(panel().getByText("сайт"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Новая сессия" }));
    expect(await panel().findByText("Сессия не создалась.")).toBeDefined();
    expect(rust.created).toEqual([]);
    expect(tabs()).toEqual(["Лендинг*"]);
  });
});

describe("вкладки", () => {
  it("сессия из левой панели открывается вкладкой, у каждого проекта свой набор", async () => {
    fakeRust();
    open();

    await openSession("Рефакторинг парсера");
    await openSession("Тесты окна");
    expect(tabs()).toEqual(["Рефакторинг парсера", "Тесты окна*"]);

    await openSession("Лендинг");
    expect(tabs()).toEqual(["Лендинг*"]);

    // Вкладки проекта ждут его: открытая сессия не заводит вторую вкладку.
    await openSession("Рефакторинг парсера");
    expect(tabs()).toEqual(["Рефакторинг парсера*", "Тесты окна"]);

    fireEvent.click(tab("Тесты окна"));
    await waitFor(() => expect(opened()).toBe("Тесты окна"));
    expect(tabs()).toEqual(["Рефакторинг парсера", "Тесты окна*"]);
  });

  it("крестик закрывает вкладку, активной становится соседняя, сессия остаётся слева", async () => {
    fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await openSession("Тесты окна");

    closeTab("Тесты окна");

    await waitFor(() => expect(tabs()).toEqual(["Рефакторинг парсера*"]));
    expect(opened()).toBe("Рефакторинг парсера");
    expect(sessionTitles("sapien")).toEqual(["Тесты окна", "Рефакторинг парсера"]);

    closeTab("Рефакторинг парсера");

    expect(await screen.findByRole("heading", { name: "Нет открытых вкладок" })).toBeDefined();
    expect(tabs()).toEqual([]);
  });

  it("недописанное сообщение ждёт свою вкладку", async () => {
    fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    fireEvent.change(field(), { target: { value: "Почини" } });

    await openSession("Тесты окна");
    expect(field().value).toBe("");
    await openSession("Рефакторинг парсера");

    expect(field().value).toBe("Почини");
  });
});

function found() {
  return within(screen.getByRole("listbox", { name: "Поиск сессии" }))
    .queryAllByRole("option")
    .map((option) => option.textContent);
}

describe("поиск сессии", () => {
  it("⌘K находит сессию по названию и проекту, Enter её открывает", async () => {
    fakeRust();
    open();
    await waitFor(() => expect(sessionTitles("sapien")).toHaveLength(2));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", cancelable: true, ...MOD }));
    });
    const query = await screen.findByRole("combobox", { name: "Поиск сессии" });
    expect(found()).toEqual(["Тесты окнаsapien", "Лендингсайт", "Рефакторинг парсераsapien"]);

    fireEvent.change(query, { target: { value: "сайт" } });
    expect(found()).toEqual(["Лендингсайт"]);
    fireEvent.change(query, { target: { value: "погода" } });
    expect(screen.getByText("Ничего не найдено")).toBeDefined();

    fireEvent.change(query, { target: { value: "парсер sapien" } });
    fireEvent.keyDown(query, { key: "Enter" });

    await waitFor(() => expect(opened()).toBe("Рефакторинг парсера"));
    expect(screen.queryByRole("combobox", { name: "Поиск сессии" })).toBeNull();
  });
});

describe("чат сессии", () => {
  it("сообщение уходит в свою сессию, ответ идёт потоком и остаётся в истории", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");

    await ask("Почини парсер");

    expect(field().value).toBe("");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toEqual({
      session: "s1",
      provider: "claude",
      model: "sonnet",
      effort: null,
      text: "Почини парсер",
      oversight: "ask",
    });

    const tool: ChatEntry = { kind: "tool", name: "Edit", target: "src/parser.ts", ok: true };
    rust.emit(tool);
    rust.emit({ kind: "text", text: "Починил " });
    rust.emit({ kind: "text", text: "парсер." });

    expect(await screen.findByText("Починил парсер.")).toBeDefined();
    expect(screen.getByText("Изменил")).toBeDefined();
    expect(screen.getByRole("button", { name: "Стоп" })).toBeDefined();

    rust.finish([{ kind: "user", text: "Почини парсер" }, tool, { kind: "assistant", text: "Починил парсер." }]);

    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(screen.getAllByText("Почини парсер")).toHaveLength(1);
    expect(screen.getAllByText("Починил парсер.")).toHaveLength(1);
  });

  it("«Стоп» останавливает ответ, пришедшее остаётся", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Расскажи");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    rust.emit({ kind: "text", text: "Начало" });

    fireEvent.click(await screen.findByRole("button", { name: "Стоп" }));
    await waitFor(() => expect(rust.stops).toEqual(["s1"]));
    rust.finish([{ kind: "user", text: "Расскажи" }, { kind: "assistant", text: "Начало" }]);

    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(screen.getByText("Начало")).toBeDefined();
  });

  it("отказ виден причиной, вопрос остаётся, «Повторить» шлёт его снова в ту же сессию", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Вопрос");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    rust.history.s1 = [{ kind: "user", text: "Вопрос" }];
    rust.fail("claude_failed");

    expect(await screen.findByText("Claude Code не ответил, попробуйте ещё раз.")).toBeDefined();
    expect(screen.getByText("Вопрос")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(rust.sent).toHaveLength(2));
    expect(rust.sent[1]).toMatchObject({ session: "s1", text: "" });

    rust.finish([{ kind: "assistant", text: "Ответ" }]);
    expect(await screen.findByText("Ответ")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("лимит подписки встаёт строкой со временем сброса, а внизу чата второй раз не повторяется", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Привет");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    // 31 октября 2026, 15:00 по Москве.
    rust.history.s1 = [{ kind: "user", text: "Привет" }, { kind: "notice", code: "claude_limit", resets: 1_793_448_000 }];
    rust.fail("claude_limit");

    const line = await screen.findByText(/Лимит подписки Claude исчерпан/);
    expect(line.textContent).toMatch(/Сбросится \d+ октября в \d\d:\d\d\./);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(rust.sent).toHaveLength(2));
    rust.finish([{ kind: "assistant", text: "Привет!" }]);

    expect(await screen.findByText("Привет!")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });

  it("ответы двух вкладок идут параллельно, каждый в своей, «Стоп» останавливает только свой", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Почини парсер");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    await openSession("Тесты окна");
    await ask("Допиши тесты");

    await waitFor(() => expect(rust.sent).toHaveLength(2));
    expect(rust.sent[1]).toMatchObject({ session: "s2", text: "Допиши тесты" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isRunning("Рефакторинг парсера")).toBe(true);
    expect(isRunning("Тесты окна")).toBe(true);

    // Rust пишет сообщение в историю в начале ответа.
    rust.history.s1 = [{ kind: "user", text: "Почини парсер" }];
    rust.history.s2 = [{ kind: "user", text: "Допиши тесты" }];
    rust.runs.s1?.emit({ kind: "text", text: "Починил парсер." });
    rust.runs.s2?.emit({ kind: "text", text: "Дописал тесты." });
    expect(await screen.findByText("Дописал тесты.")).toBeDefined();
    expect(screen.queryByText("Починил парсер.")).toBeNull();

    // Вкладка, открытая посреди ответа, не повторяет его строк.
    fireEvent.click(tab(/^Рефакторинг парсера/));
    expect(await screen.findByText("Починил парсер.")).toBeDefined();
    expect(screen.queryByText("Дописал тесты.")).toBeNull();
    expect(screen.getAllByText("Почини парсер")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Стоп" }));
    await waitFor(() => expect(rust.stops).toEqual(["s1"]));

    rust.runs.s1?.finish([{ kind: "assistant", text: "Починил парсер." }]);
    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(isRunning("Тесты окна")).toBe(true);

    rust.runs.s2?.finish([]);
    await waitFor(() => expect(isRunning("Тесты окна")).toBe(false));
  });

  it("вкладка, которая долго отвечала в фоне, не повторяет строк ответа, когда к ней вернулись", async () => {
    const rust = fakeRust();
    // Кеш сразу забывает то, что никто не показывает: так выглядят
    // несколько минут в фоне.
    open({ client: new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } }) });
    await openSession("Рефакторинг парсера");
    await ask("Почини парсер");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    // Rust пишет сообщение в историю в начале ответа.
    rust.history.s1 = [{ kind: "user", text: "Почини парсер" }];
    await openSession("Тесты окна");
    await settle();
    await openSession("Рефакторинг парсера");
    rust.emit({ kind: "text", text: "Чиню." });

    const log = within(await screen.findByRole("log", { name: "Чат с агентом" }));
    expect(await log.findByText("Чиню.")).toBeDefined();
    expect(log.getAllByText("Почини парсер")).toHaveLength(1);
  });

  it("отказ, который Rust записал в историю фоновой вкладки, после возвращения стоит в ней один раз", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Привет");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    await openSession("Тесты окна");

    rust.history.s1 = [{ kind: "user", text: "Привет" }, { kind: "notice", code: "claude_limit", resets: 1_793_448_000 }];
    rust.fail("claude_limit");
    await waitFor(() => expect(isRunning("Рефакторинг парсера")).toBe(false));
    await openSession("Рефакторинг парсера");

    expect(await screen.findByText(/Лимит подписки Claude исчерпан/)).toBeDefined();
    expect(screen.getAllByText(/Лимит подписки Claude исчерпан/)).toHaveLength(1);
  });

  it("папки проекта больше нет: история видна, отправить нельзя, новую сессию не начать", async () => {
    const rust = fakeRust({ projects: [{ ...SAPIEN, missing: true }, SITE] });
    rust.history.s1 = [{ kind: "assistant", text: "Прошлый ответ" }];
    open();
    await openSession("Рефакторинг парсера");

    expect(await screen.findByText("Прошлый ответ")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toBe(
      "Папки проекта больше нет на диске: /Users/me/sapien. История видна, а новый ответ не начнётся.",
    );

    await ask("Вопрос");

    expect(sendButton().disabled).toBe(true);
    expect(rust.sent).toHaveLength(0);
    expect(panel().getByText("нет папки")).toBeDefined();
    expect(tabs()).toEqual(["Рефакторинг парсера*"]);
    expect(screen.queryByRole("button", { name: "Новая сессия в «sapien»" })).toBeNull();
  });

  it("без сети отправить нельзя, история читается", async () => {
    const rust = fakeRust();
    rust.history.s1 = [{ kind: "assistant", text: "Прошлый ответ" }];
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    open();
    await openSession("Рефакторинг парсера");

    expect(await screen.findByText("Прошлый ответ")).toBeDefined();
    expect(screen.getByText(/Без сети агент недоступен/)).toBeDefined();

    await ask("Вопрос");

    expect(sendButton().disabled).toBe(true);
    expect(rust.sent).toHaveLength(0);
  });

  it("Claude Code без входа: чат ведёт в настройки, а отправить нельзя", async () => {
    const rust = fakeRust({ claude: { state: "logged_out", version: "2.1.316" } });
    open();
    await openSession("Рефакторинг парсера");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Вход не выполнен");
    expect(within(alert).getByRole("link", { name: "Настройки" }).getAttribute("href")).toBe("/settings/agent");

    await ask("Вопрос");

    expect(sendButton().disabled).toBe(true);
    expect(rust.sent).toHaveLength(0);
  });

});

// Пункты открытого меню выбора: подпись с подсказкой и отмечен ли пункт.
function menu() {
  return screen.getAllByRole("menuitemradio").map((item) => [item.textContent, item.getAttribute("aria-checked")]);
}

async function choose(button: string, item: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: button }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: item }));
}

describe("агент, модель и размышление", () => {
  it("под полем все модели агента, выбранные модель и размышление уходят с сообщением", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");

    fireEvent.click(await screen.findByRole("button", { name: "Провайдер: Claude Code" }));
    expect(menu()).toEqual([["Claude Code", "true"]]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Claude Code" }));

    fireEvent.click(screen.getByRole("button", { name: "Модель: Sonnet 5.5" }));
    expect(menu()).toEqual([
      ["Sonnet 5.5Для повседневных задач", "true"],
      ["Opus 5.5Для сложных задач", "false"],
      ["Haiku 5.5Самая быстрая", "false"],
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Opus 5.5/ }));

    fireEvent.click(screen.getByRole("button", { name: "Размышление: По умолчанию" }));
    expect(menu().map(([label]) => label)).toEqual([
      "По умолчанию",
      "Низкое",
      "Среднее",
      "Высокое",
      "Очень высокое",
      "Максимальное",
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Высокое" }));
    await ask("Почини парсер");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toMatchObject({ session: "s1", provider: "claude", model: "opus", effort: "high" });

    // Ответ кончился, а агент сессии закреплён.
    rust.finish([
      { kind: "user", text: "Почини парсер" },
      { kind: "assistant", text: "Починил." },
    ]);
    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Провайдер: Claude Code" }).disabled).toBe(true);
  });

  it("начатая сессия без модели продолжает своим агентом, хотя окно последним выбрало другого", async () => {
    const rust = fakeRust({ providers: [CLAUDE, CODEX] });
    // Сессия из версии без выбора агента: история есть, модели нет.
    rust.history.s1 = [
      { kind: "user", text: "Почини парсер" },
      { kind: "assistant", text: "Починил." },
    ];
    choiceStore.setState(() => ({ last: { provider: "codex", model: "gpt-5", effort: null }, sessions: {} }));
    open();
    await openSession("Рефакторинг парсера");
    expect(await screen.findByText("Починил.")).toBeDefined();

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Провайдер: Claude Code" }).disabled).toBe(true);
    await ask("Теперь тесты");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toMatchObject({ session: "s1", provider: "claude" });
  });

  it("у модели без размышления выбора уровня нет, и уровень не уходит", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await choose("Размышление: По умолчанию", /^Максимальное/);
    expect(screen.getByRole("button", { name: "Размышление: Максимальное" })).toBeDefined();

    await choose("Модель: Sonnet 5.5", /^Haiku 5.5/);

    expect(screen.queryByRole("button", { name: /^Размышление/ })).toBeNull();
    await ask("Привет");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toMatchObject({ model: "haiku", effort: null });
  });

  it("у каждой сессии свой выбор, новая начинает с последнего", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await choose("Модель: Sonnet 5.5", /^Opus 5.5/);
    await ask("Почини парсер");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    rust.finish([{ kind: "user", text: "Почини парсер" }]);

    await openSession("Тесты окна");
    // Новая для выбора сессия начинает с последнего выбора окна.
    expect(screen.getByRole("button", { name: "Модель: Opus 5.5" })).toBeDefined();
    await choose("Модель: Opus 5.5", /^Haiku 5.5/);

    await openSession("Рефакторинг парсера");
    expect(await screen.findByRole("button", { name: "Модель: Opus 5.5" })).toBeDefined();
    await openSession("Тесты окна");
    expect(screen.getByRole("button", { name: "Модель: Haiku 5.5" })).toBeDefined();
  });

  it("без агентов на устройстве выбирать нечего и отправить нельзя", async () => {
    const rust = fakeRust({ providers: [] });
    open();
    await openSession("Рефакторинг парсера");

    await ask("Вопрос");

    expect(screen.queryByRole("button", { name: /^Провайдер/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Модель/ })).toBeNull();
    expect(sendButton().disabled).toBe(true);
    expect(rust.sent).toHaveLength(0);
  });
});

const WHERE: Question = {
  kind: "choice",
  id: "q1",
  question: "Куда записать заметку о релизе?",
  options: ["CHANGELOG.md", "README.md"],
};

function access() {
  return screen.getByRole("button", { name: /^Доступ к инструментам/ });
}

describe("вопросы и разрешения", () => {
  it("на вопрос агента уходит и выбранный вариант, и написанный ответ", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Запиши заметку о релизе");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    rust.emit({ kind: "asked", question: WHERE });
    const question = await screen.findByRole("group", { name: "Вопрос агента" });
    expect(within(question).getByText("Куда записать заметку о релизе?")).toBeDefined();
    expect(screen.queryByText("Агент думает…")).toBeNull();
    fireEvent.click(within(question).getByRole("button", { name: "CHANGELOG.md" }));

    expect(rust.answers).toEqual([{ session: "s1", id: "q1", answer: { kind: "text", text: "CHANGELOG.md" } }]);
    expect(within(question).queryByRole("button", { name: "README.md" })).toBeNull();
    expect(within(question).getByText("CHANGELOG.md")).toBeDefined();

    rust.emit({ kind: "asked", question: { ...WHERE, id: "q2", question: "Как назвать раздел?" } });
    await screen.findByText("Как назвать раздел?");
    expect(field().placeholder).toBe("Свой ответ агенту, Enter отправит");
    await ask("Релиз 2.0");

    expect(rust.answers[1]).toEqual({ session: "s1", id: "q2", answer: { kind: "text", text: "Релиз 2.0" } });
    expect(rust.sent).toHaveLength(1);
    rust.finish([]);
    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
  });

  it("разрешение на инструмент: «Разрешить» и «Не разрешать» уходят агенту, просьба пропадает", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await ask("Почини парсер");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    rust.emit({ kind: "asked", question: { kind: "permission", id: "e1", tool: "Edit", target: "src/parser.ts" } });
    const edit = await screen.findByRole("group", { name: "Разрешение на инструмент" });
    expect(within(edit).getByText("Агент просит разрешение на Edit")).toBeDefined();
    expect(within(edit).getByText("src/parser.ts")).toBeDefined();
    fireEvent.click(within(edit).getByRole("button", { name: "Разрешить" }));

    rust.emit({ kind: "asked", question: { kind: "permission", id: "b1", tool: "Bash", target: "rm -rf dist" } });
    const bash = await screen.findByRole("group", { name: "Разрешение на инструмент" });
    expect(within(bash).getByText("rm -rf dist")).toBeDefined();
    fireEvent.click(within(bash).getByRole("button", { name: "Не разрешать" }));

    expect(rust.answers).toEqual([
      { session: "s1", id: "e1", answer: { kind: "allow" } },
      { session: "s1", id: "b1", answer: { kind: "deny" } },
    ]);
    expect(screen.queryByRole("group", { name: "Разрешение на инструмент" })).toBeNull();
    rust.finish([]);
    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
  });

  it("полный доступ уходит агенту, и он работает без вопросов", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    expect(access().getAttribute("aria-label")).toBe("Доступ к инструментам: По разрешению");
    fireEvent.click(access());
    expect(
      screen.getAllByRole("menuitemradio").map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["По разрешениюспрашивает перед правкой и командой", "true"],
      ["Полный доступработает без вопросов", "false"],
    ]);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Полный доступ/ }));
    await ask("Почини парсер");

    expect(access().getAttribute("aria-label")).toBe("Доступ к инструментам: Полный доступ");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]?.oversight).toBe("trust");
  });

  it("окно открылось заново посреди ответа: сессия отмечена, вопрос на месте, ответ доходит", async () => {
    const rust = fakeRust({ ongoing: WHERE });
    open({ reopened: true });
    await waitFor(() => expect(isRunning("Рефакторинг парсера")).toBe(true));
    await openSession("Рефакторинг парсера");

    const question = await screen.findByRole("group", { name: "Вопрос агента" });
    expect(screen.getByRole("button", { name: "Стоп" })).toBeDefined();
    fireEvent.click(within(question).getByRole("button", { name: "README.md" }));
    expect(rust.answers).toEqual([{ session: "s1", id: "q1", answer: { kind: "text", text: "README.md" } }]);

    rust.emit({ kind: "text", text: "Записал в README." });
    expect(await screen.findByText("Записал в README.")).toBeDefined();

    rust.finish([
      { kind: "user", text: "Запиши заметку о релизе" },
      { kind: "question", id: "q1", question: WHERE.question, options: ["CHANGELOG.md", "README.md"], answer: "README.md" },
      { kind: "assistant", text: "Записал в README." },
    ]);

    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(screen.getByText("Запиши заметку о релизе")).toBeDefined();
    expect(screen.getAllByText("Записал в README.")).toHaveLength(1);
    expect(isRunning("Рефакторинг парсера")).toBe(false);
  });
});
