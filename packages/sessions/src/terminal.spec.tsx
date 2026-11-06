import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { events } from "@sapien/ipc";
import { fakeRust, type FakeRust } from "@sapien/ipc/fake";
import { clearMocks } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { restorePanes, type Panes } from "@sapien/terminal";
import { Restoring, SessionList, SessionTabs, SessionView, useAgentEvents, useRestoredTabs } from "./index";
import type { ClaudeStatus, Project, SessionInfo } from "@sapien/ipc";
import { NO_TABS } from "./model/tabs";
import { tabsStore } from "./store/sessions.store";

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };

const MOD = { metaKey: true };

type Opened = { session: string; pane: string; cols: number; rows: number };

// Терминалы окна живут дольше теста, поэтому у сессий каждого теста свои
// номера: терминал прошлого теста не подменит терминал этого.
let round = 0;

function later(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rust с двумя сессиями проекта sapien.
function terminalRust() {
  round += 1;

  const session = (name: string, title: string, updated: number): SessionInfo => ({
    id: `${name}${round}`,
    project: "p1",
    title,
    updated,
    answering: false,
    agents: [],
  });
  const rust = fakeRust({
    state: { projects: [SAPIEN], claude: READY, sessions: [session("a", "Парсер", 2000), session("b", "Тесты", 1000)] },
  });
  // Набор в порядке, в котором его приняла оболочка.
  const written: { pane: string; data: string }[] = [];
  let received = 0;

  // Команды Rust асинхронные: первое нажатие обрабатывается дольше
  // второго и без очереди в окне пришло бы вторым.
  rust.handle("terminalWrite", () => async (pane, data) => {
    received += 1;
    await later(received === 1 ? 30 : 0);
    written.push({ pane, data });
    return null;
  });
  // Оболочка запускается не мгновенно: окно успевает показать загрузку.
  rust.handle("terminalStart", () => async () => {
    await later(30);
    return null;
  });

  return Object.assign(rust, { written });
}

// Открытые терминалы по порядку, без каналов.
function opened(rust: FakeRust): Opened[] {
  return rust.calls.terminalOpen.map(([session, pane, cols, rows]) => ({ session, pane, cols, rows }));
}

function closed(rust: FakeRust) {
  return rust.calls.terminalClose.map(([pane]) => pane);
}

// Оболочка панели напечатала text. Первая панель сессии зовётся как сессия.
function print(rust: FakeRust, pane: string, text: string) {
  act(() => rust.print(pane, text));
}

// Оболочка окна, как pages/_shell.tsx.
function Shell() {
  const ready = useRestoredTabs();

  useAgentEvents();

  if (!ready) {
    return <Restoring />;
  }

  return (
    <>
      <header>
        <SessionTabs />
      </header>
      <aside>
        <SessionList />
      </aside>
      <main>
        <Outlet />
      </main>
    </>
  );
}

function open() {
  const root = createRootRoute({ component: Shell });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: SessionView });
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
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

// Панель name, например «Панель 2».
function region(name: string) {
  return screen.getByRole("region", { name });
}

// Место терминала в панели name: на нём фокус и правая кнопка.
function paneHost(name: string) {
  return within(region(name)).getByTestId("terminal");
}

function paneNames() {
  return screen.queryAllByRole("region", { name: /^Панель/ }).map((found) => found.getAttribute("aria-label"));
}

function shownText() {
  return screen.getByTestId("terminal").textContent;
}

// Пусть окно доделает начатое: ответы Rust, перерисовка.
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
  localStorage.clear();
  restorePanes();
});

describe("терминал сессии", () => {
  it("другая вкладка не закрывает терминал: по возвращении тот же вывод, оболочка не запускается заново", async () => {
    const rust = terminalRust();
    const [parser, tests] = rust.state.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() => expect(opened(rust)).toHaveLength(1));
    print(rust, parser?.id ?? "", "первый ответ");

    await openSession("Тесты");
    await waitFor(() => expect(opened(rust).map((entry) => entry.session)).toEqual([parser?.id, tests?.id]));
    expect(shownText()).not.toContain("первый ответ");

    // Вывод фоновой вкладки не теряется.
    print(rust, parser?.id ?? "", ", и второй");
    await openSession("Парсер");
    await waitFor(() => expect(shownText()).toContain("первый ответ, и второй"));
    await settle();
    expect(opened(rust)).toHaveLength(2);
    expect(closed(rust)).toEqual([]);
  });

  it("крестик закрывает терминал вкладки, а сессия, открытая снова, запускает оболочку заново", async () => {
    const rust = terminalRust();
    const [parser] = rust.state.sessions;
    open();

    await openSession("Парсер");
    await waitFor(() => expect(opened(rust)).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Закрыть вкладку «Парсер»" }));
    await waitFor(() => expect(closed(rust)).toEqual([parser?.id]));
    expect(tabs()).toEqual([]);

    await openSession("Парсер");
    await waitFor(() => expect(opened(rust).map((entry) => entry.session)).toEqual([parser?.id, parser?.id]));
  });

  it("Rust сообщил о переменах в сессиях: окно перечитывает их, под сессией видны агенты её панелей и кто работает", async () => {
    const rust = terminalRust();
    open();

    await listed("Парсер");
    expect(agentRows("Парсер")).toEqual([]);

    // Панели «закрытая» в раскладке нет: её закрыли, а агент доделывает работу.
    rust.state.sessions = rust.state.sessions.map((session) =>
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
    await act(() => events.agentSessions.emit());

    await waitFor(() => expect(agentRows("Парсер")).toEqual(["Codex*", "Claude Code"]));
    expect(agentRows("Тесты")).toEqual([]);
  });
});

describe("открытие окна", () => {
  it("поднимает панели всех открытых вкладок, и вкладка потом подключается к своей оболочке", async () => {
    const rust = terminalRust();
    const [parser, tests] = rust.state.sessions;
    const [first, second] = [parser?.id ?? "", "правая"];

    // Парсер поделён надвое, Тесты открыты фоновой вкладкой, а вкладка
    // проекта, которого больше нет, не поднимается.
    tabsStore.setState(() => ({
      project: "p1",
      projects: {
        p1: { sessions: [first, tests?.id ?? ""], active: first, pinned: [] },
        p9: { sessions: ["чужая"], active: "чужая", pinned: [] },
      },
    }));
    const panes: Record<string, Panes> = {
      [first]: {
        layout: {
          kind: "split",
          direction: "row",
          ratio: 0.5,
          first: { kind: "pane", id: first },
          second: { kind: "pane", id: second },
        },
        active: first,
      },
    };
    // Раскладка сохранилась в прошлый запуск, окно читает её до отрисовки.
    localStorage.setItem("sapien.agent.panes", JSON.stringify(panes));
    restorePanes();
    open();

    expect(await screen.findByText("Восстанавливаю вкладки…")).toBeDefined();
    expect(tabs()).toEqual([]);
    await waitFor(() => expect(tabs()).toEqual(["Парсер*", "Тесты"]));
    expect(rust.calls.terminalStart.map(([session, pane]) => `${session}/${pane}`).toSorted()).toEqual([`${first}/${first}`, `${first}/${second}`, `${tests?.id}/${tests?.id}`]);

    // Видимая вкладка подключается к уже идущим оболочкам.
    await waitFor(() => expect(opened(rust).map((entry) => entry.pane).toSorted()).toEqual([first, second].toSorted()));
  });
});

describe("панели сессии", () => {
  it("крестик вкладки закрывает оболочки всех панелей, а открытая снова сессия возвращает те же панели", async () => {
    const rust = terminalRust();
    const [parser] = rust.state.sessions;
    open();

    await openSession("Парсер");
    fireEvent.keyDown(window, { code: "KeyD", ...MOD });
    await waitFor(() => expect(opened(rust)).toHaveLength(2));
    const fresh = opened(rust)[1]?.pane;

    fireEvent.click(screen.getByRole("button", { name: "Закрыть вкладку «Парсер»" }));
    await waitFor(() => expect(closed(rust).toSorted()).toEqual([parser?.id, fresh].toSorted()));

    await openSession("Парсер");
    await waitFor(() => expect(opened(rust)).toHaveLength(4));
    expect(opened(rust).slice(2).map((entry) => entry.pane)).toEqual([parser?.id, fresh]);
    expect(paneNames()).toEqual(["Панель 1", "Панель 2"]);
  });

  it("строка агента в левой панели открывает его сессию и делает активной его панель", async () => {
    const rust = terminalRust();
    open();

    await openSession("Парсер");
    fireEvent.keyDown(window, { code: "KeyD", ...MOD });
    await waitFor(() => expect(opened(rust)).toHaveLength(2));
    const fresh = opened(rust)[1]?.pane ?? "";
    rust.state.sessions = rust.state.sessions.map((session) =>
      session.title === "Парсер" ? { ...session, agents: [{ pane: fresh, agent: "codex", answering: false }] } : session,
    );
    await act(() => events.agentSessions.emit());
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
