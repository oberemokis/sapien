import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionList, SessionSearch, SessionTabs, SessionView } from "@/modules/agent";
import type { ClaudeStatus } from "./model/claude";
import type { Project, SessionInfo } from "./model/sessions";
import { NO_TABS } from "./model/tabs";
import { searchStore, tabsStore } from "./store/sessions.store";

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };
// Кавычка в пути: команда для терминала должна её экранировать.
const SITE: Project = { id: "p2", name: "сайт", path: "/Users/me/O'Brien/сайт", missing: false };
// Папка, которую человек выберет в системном диалоге «Добавить проект».
const DOCS: Project = { id: "p3", name: "документы", path: "/Users/me/документы", missing: false };

const SESSIONS: SessionInfo[] = [
  { id: "s1", project: "p1", title: "Рефакторинг парсера", updated: 3000, answering: false },
  { id: "s2", project: "p1", title: "Тесты окна", updated: 5000, answering: false },
  { id: "s3", project: "p2", title: "Лендинг", updated: 4000, answering: false },
];

// happy-dom представляется Linux, но тест не должен от этого зависеть.
const MOD = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };

// Rust за командами агента: проекты, их сессии и Claude Code. answering:
// сессии, в которых отвечает агент.
function fakeRust({
  projects = [SAPIEN, SITE],
  claude = READY,
  answering = [],
}: { projects?: Project[]; claude?: ClaudeStatus; answering?: string[] } = {}) {
  const rust = {
    projects: [...projects],
    sessions: SESSIONS.filter((session) => projects.some((project) => project.id === session.project)).map(
      (session) => ({ ...session, answering: answering.includes(session.id) }),
    ),
    // Сессии, которые Rust начал по просьбе окна.
    created: [] as SessionInfo[],
    removed: [] as string[],
    deleted: [] as string[],
    // Сессии, в которых Rust считает агента отвечающим, хотя окно этого не видит.
    busy: [] as string[],
  };

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
      case "agent_sessions":
        return rust.sessions;
      case "agent_session_delete": {
        const { id } = args as { id: string };

        // Как delete_session в use_case.rs: агент отвечает, отказ.
        if (rust.busy.includes(id) || rust.sessions.some((session) => session.id === id && session.answering)) {
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

        const session: SessionInfo = {
          id: `new${rust.created.length + 1}`,
          project,
          title: "",
          updated: 10_000,
          answering: false,
        };

        rust.created.push(session);
        rust.sessions = [...rust.sessions, session];
        return session;
      }
      case "agent_claude_status":
        return claude;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return rust;
}

// Оболочка окна, как pages/_shell.tsx: слева панель сессий, сверху вкладки,
// посередине активная вкладка, поверх поиск.
function Shell() {
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
      <SessionSearch />
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

// Отметка у сессии в левой панели: в ней отвечает агент.
function isAnswering(title: string) {
  const row = panel().getByText(title).closest("button");

  return row !== null && within(row).queryByText("агент отвечает") !== null;
}

// Сессию открывают в левой панели. Имя строки начинается с названия,
// за ним может стоять отметка ответа.
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

// Окно в каждом тесте новое: то, что живёт с окном, начинается заново.
afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
  tabsStore.setState(() => NO_TABS);
  searchStore.setState(() => false);
});

describe("левая панель", () => {
  it("проекты показывают свои сессии свежими сверху, отвечающий агент отмечен у своей сессии", async () => {
    fakeRust({ answering: ["s1"] });
    open();
    await waitFor(() => expect(sessionTitles("sapien")).toEqual(["Тесты окна", "Рефакторинг парсера"]));
    expect(sessionTitles("сайт")).toEqual(["Лендинг"]);

    expect(isAnswering("Рефакторинг парсера")).toBe(true);
    expect(isAnswering("Тесты окна")).toBe(false);

    await openSession("Рефакторинг парсера");
    expect(within(tab(/^Рефакторинг парсера/)).getByText("агент отвечает")).toBeDefined();
  });

  it("«+» во вкладках начинает сессию в открытом проекте новой вкладкой", async () => {
    const rust = fakeRust();
    open();
    await openSession("Лендинг");
    expect(panel().queryByRole("button", { name: /^Новая сессия в/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Новая сессия в «сайт»" }));

    await waitFor(() => expect(opened()).toBe("Новая сессия"));
    expect(rust.created.map((session) => session.project)).toEqual(["p2"]);
    expect(sessionTitles("сайт")).toEqual(["Новая сессия", "Лендинг"]);
    expect(tabs()).toEqual(["Лендинг", "Новая сессия*"]);
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

  it("сессию, где отвечает агент, удалить нельзя, отказ Rust виден, остальные удаляются", async () => {
    const rust = fakeRust({ answering: ["s1"] });
    open();
    await waitFor(() => expect(isAnswering("Рефакторинг парсера")).toBe(true));

    fireEvent.contextMenu(panel().getByText("Рефакторинг парсера"));
    const item = screen.getByRole<HTMLButtonElement>("menuitem", { name: /^Удалить сессию/ });
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain("агент отвечает");

    rust.busy.push("s2");
    fireEvent.contextMenu(panel().getByText("Тесты окна"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить сессию" }));
    expect(await screen.findByText("Сессия не удалилась.")).toBeDefined();
    expect(sessionTitles("sapien")).toEqual(["Тесты окна", "Рефакторинг парсера"]);

    fireEvent.contextMenu(panel().getByText("Лендинг"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Удалить сессию" }));
    await waitFor(() => expect(sessionTitles("сайт")).toEqual([]));
    expect(rust.deleted).toEqual(["s3"]);
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

describe("сессия", () => {
  it("папки проекта больше нет: сессия говорит об этом, новую сессию не начать", async () => {
    fakeRust({ projects: [{ ...SAPIEN, missing: true }, SITE] });
    open();
    await openSession("Рефакторинг парсера");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Папки проекта больше нет на диске: /Users/me/sapien. Агент работает в ней, сессия продолжится, когда папка вернётся.",
    );
    expect(panel().getByText("нет папки")).toBeDefined();
    expect(tabs()).toEqual(["Рефакторинг парсера*"]);
    expect(screen.queryByRole("button", { name: "Новая сессия в «sapien»" })).toBeNull();
  });

  it("Claude Code без входа: сессия ведёт в настройки", async () => {
    fakeRust({ claude: { state: "logged_out", version: "2.1.316" } });
    open();
    await openSession("Рефакторинг парсера");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Вход не выполнен");
    expect(within(alert).getByRole("link", { name: "Настройки" }).getAttribute("href")).toBe("/settings/agent");
  });

  it("с готовым Claude Code и папкой на месте плашек нет", async () => {
    fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
