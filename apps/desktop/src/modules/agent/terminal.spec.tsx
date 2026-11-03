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
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@/test-xterm";
import { ActionsView, SessionList, SessionTabs, SessionView, useActionTriggers, useAgentEvents } from "@/modules/agent";
import type { ClaudeStatus } from "./model/claude";
import type { Project, SessionInfo } from "./model/sessions";
import { NO_TABS } from "./model/tabs";
import { panesStore, tabsStore } from "./store/sessions.store";

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };

const DAY = 24 * 60 * 60 * 1000;

const MOD = { metaKey: true };

type File = { path: string; text: string };

const SUMMARY: File = { path: "Сводка.md", text: "---\nhotkey: Mod+Shift+S\n---\nСводка за {{today}}\n" };

const DAILY: File = { path: "Обзор за день.md", text: "---\nschedule: 0:00\n---\nИзменения с {{since}} по {{today}}\n" };

type Opened = { session: string; pane: string; cols: number; rows: number; task: string | null };

// Терминалы окна живут дольше теста, поэтому у сессий каждого теста свои
// номера: терминал прошлого теста не подменит терминал этого.
let round = 0;

// Rust за командами терминала. answers это ответы terminal_open по порядку,
// «failed» значит, что оболочка не запустилась, дальше они запускаются.
// runFails: Claude Code по расписанию не запускается.
function fakeRust({ actions = [] as File[], answers = [] as string[], runFails = false } = {}) {
  round += 1;

  const session = (name: string, title: string, updated: number): SessionInfo => ({
    id: `${name}${round}`,
    project: "p1",
    title,
    updated,
    answering: false,
    agents: [],
  });
  const rust = {
    sessions: [session("a", "Парсер", 2000), session("b", "Тесты", 1000)],
    created: [] as SessionInfo[],
    opened: [] as Opened[],
    // Вывод оболочек по панелям.
    channels: new Map<string, Channel<ArrayBuffer>>(),
    received: 0,
    written: [] as { pane: string; data: string }[],
    closed: [] as string[],
    runs: [] as { session: string; task: string }[],
    answers: [...answers],
  };

  mockIPC(
    async (command, args) => {
      switch (command) {
        case "projects_list":
          return [SAPIEN];
        case "agent_sessions":
          return rust.sessions;
        case "agent_claude_status":
          return READY;
        case "actions_list":
          return actions;
        case "agent_session_new": {
          const created = { ...session(`new${rust.created.length + 1}-`, "", 10_000 + rust.created.length) };

          rust.created.push(created);
          rust.sessions = [...rust.sessions, created];
          return created;
        }
        case "terminal_open": {
          const { onData, ...opened } = args as Opened & { onData: Channel<ArrayBuffer> };
          rust.opened.push(opened);

          if (rust.answers.shift() === "failed") {
            throw { kind: "unavailable", code: "terminal_failed" };
          }

          rust.channels.set(opened.pane, onData);
          return null;
        }
        case "terminal_write": {
          const written = args as { pane: string; data: string };

          // Команды Rust асинхронные: первое нажатие обрабатывается дольше
          // второго и без очереди в окне пришло бы вторым.
          rust.received += 1;
          await new Promise((resolve) => setTimeout(resolve, rust.received === 1 ? 30 : 0));
          rust.written.push(written);
          return null;
        }
        case "terminal_resize":
          return null;
        case "terminal_close":
          rust.closed.push((args as { pane: string }).pane);
          return null;
        case "terminal_run": {
          const run = args as { session: string; task: string };

          if (runFails) {
            throw { kind: "not_found", code: "claude_missing" };
          }

          rust.runs.push(run);
          return null;
        }
        default:
          throw new Error(`нет команды ${command}`);
      }
    },
    { shouldMockEvents: true },
  );

  return rust;
}

// Оболочка панели напечатала text. Первая панель сессии зовётся как сессия.
function print(rust: ReturnType<typeof fakeRust>, pane: string, text: string) {
  act(() => rust.channels.get(pane)?.onmessage(new TextEncoder().encode(text).buffer));
}

// Оболочка окна, как pages/_shell.tsx.
function Shell() {
  const navigate = useNavigate();
  const showTabs = useCallback(() => void navigate({ to: "/" }), [navigate]);
  const { deferred } = useActionTriggers({ onRun: showTabs });

  useAgentEvents();

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
    </>
  );
}

function open(at = "/") {
  const root = createRootRoute({ component: Shell });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: SessionView });
  const actions = createRoute({ getParentRoute: () => root, path: "/actions", component: ActionsView });
  const router = createRouter({
    routeTree: root.addChildren([home, actions]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function panel() {
  return within(screen.getByRole("navigation", { name: "Сессии" }));
}

// Агенты под сессией title в левой панели сверху вниз, у работающего звёздочка.
function agentRows(title: string) {
  const list = panel().queryByRole("list", { name: `Агенты сессии «${title}»` });

  return (list === null ? [] : within(list).getAllByRole("button")).map(
    (row) => `${row.querySelector("span")?.textContent}${within(row).queryByText("агент работает") === null ? "" : "*"}`,
  );
}

// Окно открылось, и в левой панели видна сессия title.
async function listed(title: string) {
  return waitFor(() => panel().getByText(title));
}

async function openSession(title: string) {
  await listed(title);
  fireEvent.click(panel().getByRole("button", { name: (name) => name.startsWith(title) }));
}

// Вкладки слева направо, у активной звёздочка.
function tabs() {
  const strip = screen.queryByRole("navigation", { name: /^Вкладки проекта/ });

  return (strip === null ? [] : within(strip).queryAllByRole("listitem")).map((item) => {
    const [show] = within(item).getAllByRole("button");

    return `${show?.title}${show?.getAttribute("aria-current") === "page" ? "*" : ""}`;
  });
}

// Терминал активной вкладки.
function terminal() {
  const shown = Terminal.created.find((candidate) => !candidate.disposed && candidate.element?.isConnected);

  if (shown === undefined) {
    throw new Error("терминала на экране нет");
  }

  return shown;
}

// Панель name, например «Панель 2».
function region(name: string) {
  return screen.getByRole("region", { name });
}

// Место терминала в панели name: на нём фокус и правая кнопка.
function paneHost(name: string) {
  return within(region(name)).getByTestId("terminal");
}

function paneTerminal(name: string) {
  const host = paneHost(name);
  const shown = Terminal.created.find((candidate) => !candidate.disposed && host.contains(candidate.element));

  if (shown === undefined) {
    throw new Error(`терминала в панели «${name}» нет`);
  }

  return shown;
}

function paneNames() {
  return screen.queryAllByRole("region", { name: /^Панель/ }).map((found) => found.getAttribute("aria-label"));
}

function shownText() {
  return screen.getByTestId("terminal").textContent;
}

function today() {
  return new Date().toLocaleDateString("sv-SE");
}

// Пусть окно доделает начатое: ответы Rust, перерисовка, тик расписания.
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

// Окно уходит раньше подделки Rust: отписка от событий идёт через неё,
// когда подписка уже ответила.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearMocks();
  tabsStore.setState(() => NO_TABS);
  panesStore.setState(() => ({}));
});

describe("терминал сессии", () => {
  it("вкладка запускает оболочку сессии размером терминала, вывод виден, набор уходит по порядку", async () => {
    const rust = fakeRust();
    const [parser] = rust.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() =>
      expect(rust.opened).toEqual([{ session: parser?.id, pane: parser?.id, cols: 80, rows: 24, task: null }]),
    );

    print(rust, parser?.id ?? "", "~/sapien $ ");
    expect(shownText()).toContain("~/sapien $");

    act(() => {
      terminal().type("п");
      terminal().type("\r");
    });
    await waitFor(() =>
      expect(rust.written).toEqual([
        { pane: parser?.id, data: "п" },
        { pane: parser?.id, data: "\r" },
      ]),
    );
  });

  it("другая вкладка не закрывает терминал: по возвращении тот же вывод, оболочка не запускается заново", async () => {
    const rust = fakeRust();
    const [parser, tests] = rust.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() => expect(rust.opened).toHaveLength(1));
    print(rust, parser?.id ?? "", "первый ответ");

    await openSession("Тесты");
    await waitFor(() => expect(rust.opened.map((opened) => opened.session)).toEqual([parser?.id, tests?.id]));
    expect(shownText()).not.toContain("первый ответ");

    // Вывод фоновой вкладки не теряется.
    print(rust, parser?.id ?? "", ", и второй");
    await openSession("Парсер");
    await waitFor(() => expect(shownText()).toContain("первый ответ, и второй"));
    await settle();
    expect(rust.opened).toHaveLength(2);
    expect(rust.closed).toEqual([]);
  });

  it("крестик закрывает терминал вкладки, а сессия, открытая снова, запускает оболочку заново", async () => {
    const rust = fakeRust();
    const [parser] = rust.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() => expect(rust.opened).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Закрыть вкладку «Парсер»" }));
    await waitFor(() => expect(rust.closed).toEqual([parser?.id]));
    expect(tabs()).toEqual([]);

    await openSession("Парсер");
    await waitFor(() => expect(rust.opened.map((opened) => opened.session)).toEqual([parser?.id, parser?.id]));
  });

  it("оболочка кончилась: плашка говорит об этом, «Открыть новую» запускает новую", async () => {
    const rust = fakeRust();
    const [parser] = rust.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() => expect(rust.opened).toHaveLength(1));

    await act(() => emit("terminal-exited", { session: parser?.id, pane: parser?.id }));
    fireEvent.click(await screen.findByRole("button", { name: "Открыть новую" }));

    await waitFor(() => expect(rust.opened).toHaveLength(2));
    expect(screen.queryByText("Оболочка завершилась.")).toBeNull();
  });

  it("оболочка не запустилась: «Повторить» запускает её снова с тем же заданием", async () => {
    const rust = fakeRust({ actions: [SUMMARY], answers: ["failed"] });
    open();

    await listed("Парсер");
    fireEvent.keyDown(window, { code: "KeyS", shiftKey: true, ...MOD });
    fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));

    await waitFor(() => expect(rust.opened).toHaveLength(2));
    expect(rust.opened[1]?.task).toBe(`Сводка за ${today()}`);
    await waitFor(() => expect(screen.queryByText("Оболочка не запустилась.")).toBeNull());
  });

  it("Rust сообщил о переменах в сессиях: окно перечитывает их, под сессией видны агенты её панелей и кто работает", async () => {
    const rust = fakeRust();
    open();

    await listed("Парсер");
    expect(agentRows("Парсер")).toEqual([]);

    // Панели «закрытая» в раскладке нет: её закрыли, а агент доделывает работу.
    rust.sessions = rust.sessions.map((session) =>
      session.title === "Парсер"
        ? {
            ...session,
            agents: [
              { pane: "закрытая", agent: "claude", answering: false },
              { pane: session.id, agent: "codex", answering: true },
            ],
            answering: true,
          }
        : session,
    );
    await act(() => emit("agent-sessions"));

    await waitFor(() => expect(agentRows("Парсер")).toEqual(["Codex*", "Claude Code"]));
    expect(agentRows("Тесты")).toEqual([]);
  });
});

describe("панели сессии", () => {
  it("⌘D делит панель вправо: у новой панели своя оболочка, набор уходит в панель, где фокус", async () => {
    const rust = fakeRust();
    const [parser] = rust.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() => expect(rust.opened).toHaveLength(1));
    print(rust, parser?.id ?? "", "до деления");

    fireEvent.keyDown(window, { code: "KeyD", ...MOD });
    await waitFor(() => expect(rust.opened).toHaveLength(2));
    const fresh = rust.opened[1]?.pane;
    expect(rust.opened[1]).toEqual({ session: parser?.id, pane: fresh, cols: 80, rows: 24, task: null });
    expect(fresh).not.toBe(parser?.id);
    expect(paneNames()).toEqual(["Панель 1", "Панель 2"]);

    // Первая панель держит свой терминал: вывод до деления на месте.
    expect(paneTerminal("Панель 1").element?.textContent).toContain("до деления");
    expect(rust.closed).toEqual([]);

    act(() => paneTerminal("Панель 2").type("2"));
    fireEvent.focusIn(paneHost("Панель 1"));
    act(() => paneTerminal("Панель 1").type("1"));
    // У каждой панели своя очередь ввода, порядок между панелями не задан.
    await waitFor(() => expect(rust.written).toHaveLength(2));
    expect(rust.written).toEqual(
      expect.arrayContaining([
        { pane: fresh, data: "2" },
        { pane: parser?.id, data: "1" },
      ]),
    );
    expect(region("Панель 1").dataset.active).toBe("true");
    expect(region("Панель 2").dataset.active).toBeUndefined();
  });

  it("граница между панелями двигается стрелками", async () => {
    fakeRust();
    open();

    await openSession("Парсер");
    fireEvent.keyDown(window, { code: "KeyD", shiftKey: true, ...MOD });
    const border = await screen.findByRole("separator", { name: "Граница панелей" });
    expect(border.getAttribute("aria-orientation")).toBe("horizontal");

    fireEvent.keyDown(border, { key: "ArrowDown" });
    expect(border.getAttribute("aria-valuenow")).toBe("55");
  });

  it("меню панели закрывает её оболочку, а единственную панель закрыть нельзя", async () => {
    const rust = fakeRust();
    const [parser] = rust.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() => expect(rust.opened).toHaveLength(1));

    fireEvent.contextMenu(paneHost("Панель 1"));
    expect(screen.getByRole("menuitem", { name: /^Закрыть панель/ })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("menuitem", { name: "Разделить вверх" }));
    await waitFor(() => expect(rust.opened).toHaveLength(2));
    const fresh = rust.opened[1]?.pane;
    // Новая панель встала сверху.
    expect(paneTerminal("Панель 1")).toBe(Terminal.created.at(-1));

    fireEvent.contextMenu(paneHost("Панель 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Закрыть панель/ }));

    await waitFor(() => expect(rust.closed).toEqual([fresh]));
    expect(paneNames()).toEqual(["Панель 1"]);
    print(rust, parser?.id ?? "", "осталась");
    expect(shownText()).toContain("осталась");
  });

  it("крестик вкладки закрывает оболочки всех панелей, а открытая снова сессия возвращает те же панели", async () => {
    const rust = fakeRust();
    const [parser] = rust.sessions;
    open();

    await openSession("Парсер");
    fireEvent.keyDown(window, { code: "KeyD", ...MOD });
    await waitFor(() => expect(rust.opened).toHaveLength(2));
    const fresh = rust.opened[1]?.pane;

    fireEvent.click(screen.getByRole("button", { name: "Закрыть вкладку «Парсер»" }));
    await waitFor(() => expect(rust.closed.toSorted()).toEqual([parser?.id, fresh].toSorted()));

    await openSession("Парсер");
    await waitFor(() => expect(rust.opened).toHaveLength(4));
    expect(rust.opened.slice(2).map((opened) => opened.pane)).toEqual([parser?.id, fresh]);
    expect(paneNames()).toEqual(["Панель 1", "Панель 2"]);
  });

  it("строка агента в левой панели открывает его сессию и делает активной его панель", async () => {
    const rust = fakeRust();
    open();

    await openSession("Парсер");
    fireEvent.keyDown(window, { code: "KeyD", ...MOD });
    await waitFor(() => expect(rust.opened).toHaveLength(2));
    const fresh = rust.opened[1]?.pane ?? "";
    rust.sessions = rust.sessions.map((session) =>
      session.title === "Парсер" ? { ...session, agents: [{ pane: fresh, agent: "codex", answering: false }] } : session,
    );
    await act(() => emit("agent-sessions"));
    await waitFor(() => expect(agentRows("Парсер")).toEqual(["Codex"]));

    // Вкладка закрыта, активна первая панель.
    fireEvent.focusIn(paneHost("Панель 1"));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть вкладку «Парсер»" }));
    await waitFor(() => expect(tabs()).toEqual([]));

    fireEvent.click(panel().getByRole("button", { name: "Codex" }));
    await waitFor(() => expect(tabs()).toEqual(["Парсер*"]));
    expect(region("Панель 2").dataset.active).toBe("true");

    // Вкладка на экране, фокус ушёл в первую панель.
    fireEvent.focusIn(paneHost("Панель 1"));
    expect(region("Панель 2").dataset.active).toBeUndefined();
    fireEvent.click(panel().getByRole("button", { name: "Codex" }));
    expect(region("Панель 2").dataset.active).toBe("true");
  });
});

describe("действия", () => {
  it("клавиша начинает новую сессию вкладкой, в её оболочке Claude Code получает задание", async () => {
    const rust = fakeRust({ actions: [SUMMARY] });
    open();

    await listed("Парсер");
    fireEvent.keyDown(window, { code: "KeyS", shiftKey: true, ...MOD });

    await waitFor(() => expect(rust.opened).toHaveLength(1));
    expect(rust.opened[0]).toMatchObject({ session: rust.created[0]?.id, task: `Сводка за ${today()}` });
    expect(tabs()).toEqual(["Новая сессия*"]);
  });

  it("«Запустить» на экране действий открывает новую сессию с заданием", async () => {
    const rust = fakeRust({ actions: [SUMMARY] });
    open("/actions");

    const row = (await screen.findByText("Сводка")).parentElement?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Запустить" }));

    await waitFor(() => expect(rust.opened).toHaveLength(1));
    expect(rust.opened[0]).toMatchObject({ session: rust.created[0]?.id, task: `Сводка за ${today()}` });
  });

  it("срок по расписанию запускает Claude Code без вкладки, а открытая потом сессия подключается к нему", async () => {
    const since = new Date(Date.now() - 8 * DAY);
    localStorage.setItem("sapien.actions.runs", JSON.stringify({ [DAILY.path]: { at: since.getTime(), ran: true } }));
    const rust = fakeRust({ actions: [DAILY] });
    open();

    await waitFor(() => expect(rust.runs).toHaveLength(1));
    expect(rust.runs[0]).toEqual({
      session: rust.created[0]?.id,
      task: `Изменения с ${since.toLocaleDateString("sv-SE")} по ${today()}`,
    });
    // Экран за действием не переключается.
    expect(screen.getByRole("heading", { name: "Нет открытых вкладок" })).toBeDefined();
    expect(rust.opened).toEqual([]);

    await openSession("Новая сессия");
    await waitFor(() => expect(rust.opened).toHaveLength(1));
    expect(rust.opened[0]).toMatchObject({ session: rust.created[0]?.id, task: null });
  });

  it("Claude Code по расписанию не запустился: задание уйдёт, когда сессию откроют", async () => {
    localStorage.setItem("sapien.actions.runs", JSON.stringify({ [DAILY.path]: { at: Date.now() - 8 * DAY, ran: true } }));
    const rust = fakeRust({ actions: [DAILY], runFails: true });
    open();

    await waitFor(() => expect(rust.created).toHaveLength(1));
    await settle();
    await openSession("Новая сессия");

    await waitFor(() => expect(rust.opened).toHaveLength(1));
    expect(rust.opened[0]?.task).toMatch(/^Изменения с /);
  });
});
