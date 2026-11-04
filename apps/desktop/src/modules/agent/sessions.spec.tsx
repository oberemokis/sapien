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
import type { Project, SessionInfo } from "./model/sessions";
import { NO_TABS } from "./model/tabs";
import { searchStore, tabsStore } from "./store/sessions.store";

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };
// Кавычка в пути: команда для терминала должна её экранировать.
const SITE: Project = { id: "p2", name: "сайт", path: "/Users/me/O'Brien/сайт", missing: false };
// Папка, которую человек выберет в системном диалоге «Добавить проект».
const DOCS: Project = { id: "p3", name: "документы", path: "/Users/me/документы", missing: false };

const SESSIONS: SessionInfo[] = [
  { id: "s1", project: "p1", title: "Рефакторинг парсера", updated: 3000, answering: false, agents: [] },
  { id: "s2", project: "p1", title: "Тесты окна", updated: 5000, answering: false, agents: [] },
  { id: "s3", project: "p2", title: "Лендинг", updated: 4000, answering: false, agents: [] },
];

const MOD = { metaKey: true };

// Rust за командами агента: проекты и их сессии. answering: сессии,
// в первой панели которых работает Claude Code.
function fakeRust({ projects = [SAPIEN, SITE], answering = [] }: { projects?: Project[]; answering?: string[] } = {}) {
  const rust = {
    projects: [...projects],
    sessions: SESSIONS.filter((session) => projects.some((project) => project.id === session.project)).map(
      (session) => ({
        ...session,
        answering: answering.includes(session.id),
        agents: answering.includes(session.id) ? [{ pane: session.id, agent: "claude", answering: true }] : [],
      }),
    ),
    // Сессии, которые Rust начал по просьбе окна.
    created: [] as SessionInfo[],
    removed: [] as string[],
    deleted: [] as string[],
    // Сессии, в которых Rust считает агента отвечающим, хотя окно этого не видит.
    busy: [] as string[],
    renamed: [] as { id: string; title: string }[],
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
          agents: [],
        };

        rust.created.push(session);
        rust.sessions = [...rust.sessions, session];
        return session;
      }
      // Как rename_session в use_case.rs: пробелы по краям не остаются.
      case "agent_session_rename": {
        const { id, title } = args as { id: string; title: string };

        rust.renamed.push({ id, title });
        rust.sessions = rust.sessions.map((session) => (session.id === id ? { ...session, title: title.trim() } : session));
        return null;
      }
      // Терминал открытой вкладки: его проверяет terminal.spec.tsx.
      case "terminal_open":
        return null;
      case "terminal_write":
      case "terminal_resize":
      case "terminal_close":
        return null;
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

// Названия сессий проекта в левой панели сверху вниз. Агенты под сессией
// в счёт не идут.
function sessionTitles(project: string) {
  const item = panel().getByText(project).closest("li");

  if (item === null) {
    throw new Error(`нет проекта ${project}`);
  }

  return within(item)
    .queryAllByRole("listitem")
    .filter((row) => row.closest("ul")?.parentElement === item)
    .map((row) => row.querySelector("span")?.textContent);
}

// Отметка у агента под сессией в левой панели: он работает.
function isAnswering(title: string) {
  const agents = panel().queryByRole("list", { name: `Агенты сессии «${title}»` });

  return agents !== null && within(agents).queryByText("агент работает") !== null;
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

// Вкладки открытого проекта слева направо, у активной звёздочка, у
// закреплённой «^» впереди. Первая кнопка вкладки открывает её, вторая
// закрывает.
function tabs() {
  const strip = screen.queryByRole("navigation", TAB_STRIP);

  return (strip === null ? [] : within(strip).queryAllByRole("listitem")).map((item) => {
    const [show] = within(item).getAllByRole("button");
    const pinned = within(item).queryByText("закреплена") === null ? "" : "^";

    return `${pinned}${show?.title}${show?.getAttribute("aria-current") === "page" ? "*" : ""}`;
  });
}

// Вкладка title в полосе вкладок, сама строка списка.
function tabItem(title: string) {
  return within(screen.getByRole("navigation", TAB_STRIP)).getByTitle(title).closest("li") as HTMLElement;
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
  it("проекты показывают свои сессии свежими сверху, работающий агент отмечен у своей сессии", async () => {
    fakeRust({ answering: ["s1"] });
    open();
    await waitFor(() => expect(sessionTitles("sapien")).toEqual(["Тесты окна", "Рефакторинг парсера"]));
    expect(sessionTitles("сайт")).toEqual(["Лендинг"]);

    expect(isAnswering("Рефакторинг парсера")).toBe(true);
    expect(isAnswering("Тесты окна")).toBe(false);

    await openSession("Рефакторинг парсера");
    expect(within(tab(/^Рефакторинг парсера/)).getByText("агент работает")).toBeDefined();
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

  it("сессию, где работает агент, удалить нельзя, отказ Rust виден, остальные удаляются", async () => {
    const rust = fakeRust({ answering: ["s1"] });
    open();
    await waitFor(() => expect(isAnswering("Рефакторинг парсера")).toBe(true));

    fireEvent.contextMenu(panel().getByText("Рефакторинг парсера"));
    const item = screen.getByRole<HTMLButtonElement>("menuitem", { name: /^Удалить сессию/ });
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain("агент работает");

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

  it("двойное нажатие переименовывает сессию: новое имя и во вкладке, и слева, Escape отменяет", async () => {
    const rust = fakeRust();
    open();
    await openSession("Тесты окна");

    fireEvent.doubleClick(tab("Тесты окна"));
    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Имя вкладки" });
    expect(field.value).toBe("Тесты окна");
    fireEvent.change(field, { target: { value: "Забыть" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(tabs()).toEqual(["Тесты окна*"]);

    fireEvent.doubleClick(tab("Тесты окна"));
    const again = screen.getByRole("textbox", { name: "Имя вкладки" });
    fireEvent.change(again, { target: { value: "  Релиз 0.3 " } });
    fireEvent.keyDown(again, { key: "Enter" });

    await waitFor(() => expect(tabs()).toEqual(["Релиз 0.3*"]));
    expect(sessionTitles("sapien")).toEqual(["Релиз 0.3", "Рефакторинг парсера"]);
    expect(rust.renamed).toEqual([{ id: "s2", title: "  Релиз 0.3 " }]);
  });

  it("закреплённая вкладка встаёт левее остальных, без крестика, и закрыть её из меню нельзя", async () => {
    fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await openSession("Тесты окна");

    fireEvent.contextMenu(tab("Тесты окна"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Закрепить" }));

    expect(tabs()).toEqual(["^Тесты окна*", "Рефакторинг парсера"]);
    expect(screen.queryByRole("button", { name: "Закрыть вкладку «Тесты окна»" })).toBeNull();

    fireEvent.contextMenu(tab(/^Тесты окна/));
    expect(screen.queryByRole("menuitem", { name: "Закрыть вкладку" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Открепить" }));
    expect(tabs()).toEqual(["Тесты окна*", "Рефакторинг парсера"]);
  });

  it("вкладку перетаскивают на новое место, а отпущенная она не открывается", async () => {
    fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await openSession("Тесты окна");

    // Вкладки по 100 px слева направо.
    for (const [index, title] of ["Рефакторинг парсера", "Тесты окна"].entries()) {
      vi.spyOn(tabItem(title), "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: index * 100, width: 100 }));
    }

    // Фоновую вкладку тащат правее середины соседки.
    fireEvent.pointerDown(tab("Рефакторинг парсера"), { button: 0, clientX: 50 });
    fireEvent.pointerMove(window, { clientX: 180 });
    fireEvent.pointerUp(window, { clientX: 180 });
    fireEvent.click(tab("Рефакторинг парсера"));

    expect(tabs()).toEqual(["Тесты окна*", "Рефакторинг парсера"]);

    // Короткий сдвиг это нажатие, а не перетаскивание.
    fireEvent.pointerDown(tab("Рефакторинг парсера"), { button: 0, clientX: 150 });
    fireEvent.pointerUp(window, { clientX: 152 });
    fireEvent.click(tab("Рефакторинг парсера"));
    await waitFor(() => expect(tabs()).toEqual(["Тесты окна", "Рефакторинг парсера*"]));
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
      "Папки проекта больше нет на диске: /Users/me/sapien. Терминал открывается в ней, сессия продолжится, когда папка вернётся.",
    );
    expect(panel().getByText("нет папки")).toBeDefined();
    expect(tabs()).toEqual(["Рефакторинг парсера*"]);
    expect(screen.queryByRole("button", { name: "Новая сессия в «sapien»" })).toBeNull();
  });

  it("с папкой на месте плашек нет", async () => {
    fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
