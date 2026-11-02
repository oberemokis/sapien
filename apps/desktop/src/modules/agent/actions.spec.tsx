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
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionsView, SessionList, SessionView, useActionTriggers } from "@/modules/agent";
import type { AgentCommand } from "./model/agents";
import type { Oversight } from "./model/chat";
import type { Project, SessionInfo } from "./model/sessions";
import { NO_TABS } from "./model/tabs";
import { chatStore, draftStore, tabsStore } from "./store/chat.store";
import { choiceStore } from "./store/choice.store";

type Sent = {
  session: string;
  provider: string;
  model: string | null;
  effort: string | null;
  text: string;
  oversight: Oversight;
};
type File = { path: string; text: string };

// Claude Code с одной моделью: действие уходит с ней.
const CLAUDE = {
  id: "claude",
  name: "Claude Code",
  models: [{ id: "sonnet", resolved: "claude-sonnet-5-5", name: "Sonnet 5.5", description: "", efforts: [] }],
};

// Сессия, которая ещё не отвечала.
const FRESH = { provider: "claude", model: null, effort: null, started: false };

// То, с чем уходит каждое задание действия в этих тестах.
const AGENT = { provider: "claude", model: "sonnet", effort: null };

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };
const SITE: Project = { id: "p2", name: "сайт", path: "/Users/me/сайт", missing: false };
// Папка, которую человек выберет в системном диалоге «Добавить проект».
const DOCS: Project = { id: "p3", name: "документы", path: "/Users/me/документы", missing: false };

// Последняя сессия во втором проекте: новая сессия без открытой встаёт туда.
const SESSIONS: SessionInfo[] = [
  { id: "s1", project: "p1", title: "Рефакторинг парсера", updated: 3000, ...FRESH },
  { id: "s2", project: "p1", title: "Тесты окна", updated: 5000, ...FRESH },
  { id: "s3", project: "p2", title: "Лендинг", updated: 4000, ...FRESH },
];

// Действия лежат файлами в папке приложения: путь это имя файла.
const ACTIONS: File[] = [
  { path: "Обзор изменений.md", text: "---\nhotkey: Mod+Shift+J\nschedule:\n---\nПосмотри изменения\n" },
  { path: "Сводка.md", text: "---\nhotkey: Mod+Shift+S\n---\nСводка за {{today}}\n" },
  { path: "Пустое.md", text: "---\nhotkey: Mod+Shift+E\n---\n" },
];

// Команды Claude Code в папке проекта: свой скил и встроенная команда
// с другим именем.
const COMMANDS: AgentCommand[] = [
  { name: "review", description: "Проверить пул-реквест", aliases: [], builtin: false },
  { name: "clear", description: "Начать разговор заново", aliases: ["reset"], builtin: true },
];

// Rust за командами агента и действий. Ответ агента приходит сразу.
// refuse это код отказа actions_create. commands это команды агента
// в папке проекта, по умолчанию их нет, refuseCommands: сколько первых
// запросов команд агент не ответит. refuseProviders это код отказа
// в списке агентов.
function fakeRust({
  actions = ACTIONS,
  projects = [SAPIEN, SITE],
  commands = [],
  refuseCommands = 0,
  refuseProviders,
  refuse,
}: {
  actions?: File[];
  projects?: Project[];
  commands?: AgentCommand[];
  refuseCommands?: number;
  refuseProviders?: string;
  refuse?: string;
} = {}) {
  const rust = {
    projects: [...projects],
    sessions: SESSIONS.filter((session) => projects.some((project) => project.id === session.project)),
    actions: [...actions],
    // У кого и где окно спрашивало команды.
    asked: [] as { provider: string; project: string }[],
    // Сессии, которые Rust начал по просьбе окна.
    created: [] as SessionInfo[],
    written: [] as File[],
    deleted: [] as string[],
    sent: [] as Sent[],
  };

  mockIPC((command, args) => {
    switch (command) {
      case "projects_list":
        return rust.projects;
      case "projects_add":
        rust.projects = [...rust.projects, DOCS];
        return DOCS;
      case "agent_sessions":
        return rust.sessions;
      case "agent_session_new": {
        const { project } = args as { project: string };

        if (rust.projects.find((candidate) => candidate.id === project)?.missing !== false) {
          throw { kind: "not_found", code: "project_missing" };
        }

        const session: SessionInfo = {
          id: `new${rust.created.length + 1}`,
          project,
          title: "",
          updated: 10_000 + rust.created.length,
          ...FRESH,
        };

        rust.created.push(session);
        rust.sessions = [...rust.sessions, session];
        // Ответ Tauri приходит отдельной задачей, и окно успевает
        // перерисоваться, пока его ждёт.
        return new Promise((resolve) => setTimeout(() => resolve(session), 0));
      }
      case "agent_history":
        return [];
      case "agent_claude_status":
        return { state: "ready", version: "2.1.316" };
      case "agent_providers":
        if (refuseProviders !== undefined) {
          throw { kind: "unavailable", code: refuseProviders };
        }

        return [CLAUDE];
      case "agent_commands": {
        const { provider, project } = args as { provider: string; project: string };

        rust.asked.push({ provider, project });

        if (rust.asked.length <= refuseCommands) {
          throw { kind: "unavailable", code: "claude_failed" };
        }

        return { commands };
      }
      case "agent_send": {
        const { session, provider, model, effort, text, oversight } = args as Sent;

        rust.sent.push({ session, provider, model, effort, text, oversight });
        return null;
      }
      case "actions_list":
        return rust.actions;
      case "actions_create": {
        const { name, text } = args as { name: string; text: string };

        if (refuse !== undefined) {
          throw { kind: "conflict", code: refuse };
        }

        rust.actions = [...rust.actions, { path: `${name}.md`, text }];
        return `${name}.md`;
      }
      case "actions_write": {
        const file = args as File;

        rust.written.push(file);
        rust.actions = rust.actions.map((action) => (action.path === file.path ? file : action));
        return null;
      }
      case "actions_delete": {
        const { path } = args as { path: string };

        rust.deleted.push(path);
        rust.actions = rust.actions.filter((action) => action.path !== path);
        return null;
      }
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return rust;
}

// Оболочка окна, как pages/_shell.tsx: клавиши и расписание действий
// работают на любом её экране.
function Shell() {
  const navigate = useNavigate();
  const showChat = useCallback(() => void navigate({ to: "/" }), [navigate]);
  const { deferred } = useActionTriggers({ onRun: showChat });

  return (
    <>
      <aside>
        <SessionList deferred={deferred} />
      </aside>
      <main>
        <Outlet />
      </main>
    </>
  );
}

function open({ at = "/" } = {}) {
  const root = createRootRoute({ component: Shell });
  const chat = createRoute({ getParentRoute: () => root, path: "/", component: SessionView });
  const actions = createRoute({ getParentRoute: () => root, path: "/actions", component: ActionsView });
  const router = createRouter({
    routeTree: root.addChildren([chat, actions]),
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

// Открытая сессия отмечена в левой панели, за названием может стоять
// отметка идущего ответа.
function opened() {
  return panel().queryByRole("button", { current: "page" })?.textContent ?? "";
}

// Чат открытой сессии на экране: поле ввода есть только в нём.
async function chatOf(title: string) {
  await screen.findByLabelText("Сообщение агенту");
  await waitFor(() => expect(opened().startsWith(title)).toBe(true));
}

async function openSession(title: string) {
  await waitFor(() => panel().getByText(title));
  fireEvent.click(panel().getByRole("button", { name: title }));
  await chatOf(title);
}

async function type(text: string) {
  fireEvent.change(await screen.findByLabelText("Сообщение агенту"), { target: { value: text } });
}

function press(key: string) {
  fireEvent.keyDown(screen.getByLabelText("Сообщение агенту"), { key });
}

function options() {
  return screen.queryAllByRole("option").map((option) => option.textContent);
}

// В тестах не macOS: Mod это Ctrl, подписи клавиш вида «Ctrl+Shift+J».
function hotkey(code: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, ctrlKey: true, shiftKey: true, cancelable: true }));
  });
}

// Даёт окну время сделать то, чего делать не должно.
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function today() {
  return new Date().toLocaleDateString("sv-SE");
}

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
  chatStore.setState(() => ({ runs: {}, problems: {}, askEdits: true }));
  tabsStore.setState(() => NO_TABS);
  draftStore.setState(() => ({}));
  choiceStore.setState(() => ({ last: null, sessions: {} }));
});

describe("действия в чате", () => {
  it("«/» показывает действия с заданием, стрелки выбирают, Enter запускает в открытой сессии", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");

    await type("/");
    await waitFor(() => expect(options()).toEqual(["Обзор измененийCtrl+Shift+J", "СводкаCtrl+Shift+S"]));
    press("ArrowDown");
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("Сводка");
    press("Enter");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toEqual({
      session: "s1",
      ...AGENT,
      text: `Сводка за ${today()}`,
      oversight: "ask",
    });
    expect(screen.getByLabelText<HTMLTextAreaElement>("Сообщение агенту").value).toBe("");
  });

  it("текст после «/» сужает список, без совпадений Enter шлёт его сообщением", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");

    await type("/свод");
    await waitFor(() => expect(options()).toEqual(["СводкаCtrl+Shift+S"]));
    await type("/погода");
    expect(options()).toEqual([]);
    expect(screen.getByText(/Ничего не нашлось/)).toBeDefined();
    press("Enter");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toMatchObject({ session: "s1", text: "/погода" });
  });

  it("за действиями идут команды агента из папки проекта, Enter вписывает команду, и она уходит как есть", async () => {
    const rust = fakeRust({ commands: COMMANDS });
    open();
    await openSession("Рефакторинг парсера");

    await type("/");
    await waitFor(() =>
      expect(options()).toEqual([
        "Обзор измененийCtrl+Shift+J",
        "СводкаCtrl+Shift+S",
        "/reviewПроверить пул-реквест",
        "/clearНачать разговор заново",
      ]),
    );
    expect(rust.asked).toEqual([{ provider: "claude", project: "p1" }]);

    await type("/rev");
    expect(options()).toEqual(["/reviewПроверить пул-реквест"]);
    press("Enter");

    const field = screen.getByLabelText<HTMLTextAreaElement>("Сообщение агенту");
    expect(field.value).toBe("/review ");
    expect(screen.queryByRole("listbox")).toBeNull();
    await settle();
    expect(rust.sent).toEqual([]);

    await type("/review 12");
    press("Enter");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toMatchObject({ session: "s1", text: "/review 12" });
  });

  it("стрелки ведут выбор за край списка, и выбранная строка прокручивается на вид", async () => {
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    fakeRust({ commands: COMMANDS });
    open();
    await openSession("Рефакторинг парсера");

    await type("/");
    await waitFor(() => expect(options()).toHaveLength(4));
    // С первой строки вверх: выбор уходит на последнюю.
    press("ArrowUp");

    const selected = screen.getByRole("option", { selected: true });
    expect(selected.textContent).toBe("/clearНачать разговор заново");
    expect(scrolled.at(-1)).toBe(selected);
  });

  it("Escape прячет список, а набранное остаётся и уходит сообщением, следующий набор открывает список снова", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");

    await type("/свод");
    await waitFor(() => expect(options()).toEqual(["СводкаCtrl+Shift+S"]));
    press("Escape");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Сообщение агенту").value).toBe("/свод");

    await type("/сво");
    expect(options()).toEqual(["СводкаCtrl+Shift+S"]);
    press("Escape");
    press("Enter");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toMatchObject({ session: "s1", text: "/сво" });
  });

  it("команды не загрузились: список говорит об этом, «Повторить» спрашивает агента снова", async () => {
    const rust = fakeRust({ commands: COMMANDS, refuseCommands: 1 });
    open();
    await openSession("Рефакторинг парсера");

    await type("/");
    expect(await screen.findByText("Команды агента не загрузились.")).toBeDefined();
    expect(options()).toEqual(["Обзор измененийCtrl+Shift+J", "СводкаCtrl+Shift+S"]);

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() => expect(options()).toContain("/reviewПроверить пул-реквест"));
    expect(screen.queryByText("Команды агента не загрузились.")).toBeNull();
    expect(rust.asked).toHaveLength(2);
  });

  it("команду находит и её другое имя", async () => {
    fakeRust({ commands: COMMANDS });
    open();
    await openSession("Рефакторинг парсера");

    await type("/reset");

    await waitFor(() => expect(options()).toEqual(["/clearНачать разговор заново"]));
  });

  it("без действий и команд одна «/» списка не открывает", async () => {
    fakeRust({ actions: [] });
    open();
    await openSession("Рефакторинг парсера");

    await type("/");
    await settle();

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText(/Ничего не нашлось/)).toBeNull();
  });

  it("клавиша с другого экрана возвращает в чат открытой сессии и запускает там действие", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    fireEvent.click(screen.getByRole("link", { name: "Действия" }));
    await screen.findByText("Обзор изменений");

    hotkey("KeyJ");

    await chatOf("Рефакторинг парсера");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent).toEqual([{ session: "s1", ...AGENT, text: "Посмотри изменения", oversight: "ask" }]);
    expect(rust.created).toEqual([]);
  });

  it("у действия без задания клавиша ничего не делает", async () => {
    const rust = fakeRust();
    open({ at: "/actions" });
    await screen.findByText("Пустое");

    hotkey("KeyE");
    await settle();

    expect(rust.sent).toEqual([]);
    expect(rust.created).toEqual([]);
    expect(screen.getByRole("heading", { name: "Действия" })).toBeDefined();
  });

  it("клавиша без открытой сессии начинает новую в проекте последней сессии и открывает её", async () => {
    const rust = fakeRust();
    open({ at: "/actions" });
    await screen.findByText("Обзор изменений");

    hotkey("KeyJ");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.created.map((session) => session.project)).toEqual(["p1"]);
    expect(rust.sent[0]).toMatchObject({ session: rust.created[0]?.id, text: "Посмотри изменения" });
    expect(await screen.findByLabelText("Сообщение агенту")).toBeDefined();
    expect(panel().getByRole("button", { current: "page" })).toBeDefined();
  });

  it("отказ Rust в списке агентов чат называет своей причиной, а не «Claude Code не найден»", async () => {
    const rust = fakeRust({ refuseProviders: "claude_failed" });
    open();
    await openSession("Рефакторинг парсера");

    hotkey("KeyJ");

    expect(await screen.findByText("Claude Code не ответил, попробуйте ещё раз.")).toBeDefined();
    expect(screen.queryByText(/Claude Code не найден/)).toBeNull();
    expect(rust.sent).toEqual([]);
  });

  it("клавиша, пока открытая сессия отвечает, начинает новую в её проекте и шлёт задание туда", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");
    act(() => {
      chatStore.setState((state) => ({ ...state, runs: { s1: { entries: [], open: null } } }));
    });

    hotkey("KeyJ");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.created.map((session) => session.project)).toEqual(["p1"]);
    expect(rust.sent[0]).toMatchObject({ session: rust.created[0]?.id, text: "Посмотри изменения" });
    // Открыта новая сессия: название у неё из задания или пока пустое.
    await waitFor(() => expect(opened()).toMatch(/^(Посмотри изменения|Новая сессия)/));
  });

  it("без сети действия помечены и не запускаются ни списком, ни клавишей", async () => {
    const rust = fakeRust();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    open();
    await openSession("Рефакторинг парсера");

    await type("/");
    await waitFor(() => expect(options()).toEqual(["Обзор измененийнет сети", "Сводканет сети"]));
    press("Enter");
    hotkey("KeyJ");
    await settle();

    expect(rust.sent).toEqual([]);
  });
});

const DAY = 24 * 60 * 60 * 1000;

// Обзор каждый день в полночь: срок прошёл сегодня, что бы ни показывали часы.
const DAILY: File = { path: "Обзор за день.md", text: "---\nschedule: 0:00\n---\nИзменения с {{since}} по {{today}}\n" };

// Второе действие в тот же срок.
const REPORT: File = { path: "Отчёт.md", text: "---\nschedule: 0:00\n---\nОтчёт за {{today}}\n" };

// Прошлый запуск неделю с лишним назад: окно запомнило его в своём хранилище.
function ranLongAgo(files = [DAILY]) {
  const at = Date.now() - 8 * DAY;

  localStorage.setItem(
    "sapien.actions.runs",
    JSON.stringify(Object.fromEntries(files.map((file) => [file.path, { at, ran: true }]))),
  );

  return new Date(at).toLocaleDateString("sv-SE");
}

describe("действия по расписанию", () => {
  it("срок, пропущенный при закрытом приложении, уходит при открытии в новой сессии без человека и один раз", async () => {
    const rust = fakeRust({ actions: [DAILY] });
    const since = ranLongAgo();
    open();

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.created.map((session) => session.project)).toEqual(["p1"]);
    expect(rust.sent[0]).toEqual({
      session: rust.created[0]?.id,
      ...AGENT,
      text: `Изменения с ${since} по ${today()}`,
      oversight: "away",
    });
    // Экран за действием не переключается.
    expect(screen.getByRole("heading", { name: "Нет открытых вкладок" })).toBeDefined();

    cleanup();
    open();
    await screen.findByRole("heading", { name: "Нет открытых вкладок" });
    await settle();
    expect(rust.sent).toHaveLength(1);
  });

  it("два срока сразу уходят каждый в свою сессию, пустых сессий не остаётся", async () => {
    const rust = fakeRust({ actions: [DAILY, REPORT] });
    ranLongAgo([DAILY, REPORT]);
    open();

    await waitFor(() => expect(rust.sent).toHaveLength(2));
    await settle();

    expect(rust.sent).toHaveLength(2);
    expect(rust.sent.map((sent) => sent.session).toSorted()).toEqual(rust.created.map((session) => session.id).toSorted());
    expect(rust.sent.map((sent) => sent.text.split(" ")[0]).toSorted()).toEqual(["Изменения", "Отчёт"]);
  });

  it("без сети срок ждёт, окно говорит, что отложено, а с сетью действие уходит в проект открытой сессии", async () => {
    const rust = fakeRust({ actions: [DAILY] });
    ranLongAgo();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    open();

    expect(await screen.findByText("Отложено до появления сети и проекта: Обзор за день. Запустится само.")).toBeDefined();
    await openSession("Лендинг");
    expect(rust.sent).toEqual([]);

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.created.map((session) => session.project)).toEqual(["p2"]);
    expect(rust.sent[0]).toMatchObject({ session: rust.created[0]?.id, oversight: "away" });
    expect(opened().startsWith("Лендинг")).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Отложено/)).toBeNull());
  });

  it("без проектов действие отложено, а с первым проектом уходит в новую сессию в нём", async () => {
    const rust = fakeRust({ actions: [DAILY], projects: [] });
    ranLongAgo();
    open();

    expect(await screen.findByText(/Отложено до появления сети и проекта: Обзор за день/)).toBeDefined();
    expect(rust.sent).toEqual([]);

    fireEvent.click(await within(screen.getByRole("main")).findByRole("button", { name: "Добавить проект" }));

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.created.find((session) => session.id === rust.sent[0]?.session)?.project).toBe("p3");
    expect(rust.sent[0]?.oversight).toBe("away");
  });

  it("новое действие с расписанием только замечается и не уходит сразу", async () => {
    const rust = fakeRust({ actions: [DAILY] });
    open({ at: "/actions" });

    await screen.findByText("Обзор за день");
    await settle();

    expect(rust.sent).toEqual([]);
    expect(rust.created).toEqual([]);
  });
});

// Строка действия в списке: название, пояснение и кнопки.
async function row(name: string) {
  const line = (await screen.findByText(name)).parentElement?.parentElement;

  if (line === null || line === undefined) {
    throw new Error(`нет строки ${name}`);
  }

  return within(line);
}

function createButton() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Создать" });
}

function hotkeyField() {
  return screen.getByLabelText<HTMLInputElement>("Горячая клавиша");
}

describe("экран «Действия»", () => {
  it("новое действие ложится файлом с шапкой и встаёт в список", async () => {
    const rust = fakeRust();
    open({ at: "/actions" });

    fireEvent.change(await screen.findByLabelText("Название"), { target: { value: " Обзор недели " } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "Собери изменения с {{since}}" } });
    fireEvent.keyDown(hotkeyField(), { code: "KeyY", ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByLabelText("Расписание"), { target: { value: "пн 10:00" } });
    expect(hotkeyField().value).toBe("Ctrl+Shift+Y");
    fireEvent.click(createButton());

    expect((await row("Обзор недели")).getByText("Ctrl+Shift+Y · по расписанию пн 10:00")).toBeDefined();
    expect(rust.actions.at(-1)).toEqual({
      path: "Обзор недели.md",
      text: "---\nhotkey: Mod+Shift+Y\nschedule: пн 10:00\n---\nСобери изменения с {{since}}\n",
    });
  });

  it("после создания форма пустеет для следующего действия", async () => {
    fakeRust();
    open({ at: "/actions" });

    fireEvent.change(await screen.findByLabelText("Название"), { target: { value: "Обзор недели" } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "Собери изменения" } });
    fireEvent.click(createButton());
    await screen.findByText("Обзор недели");

    expect(screen.queryByText("Действие с таким названием уже есть")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Название").value).toBe("");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Задание агенту").value).toBe("");
  });

  it("занятое название, занятая клавиша и кривое расписание подсказаны, создать нельзя", async () => {
    fakeRust();
    open({ at: "/actions" });
    await screen.findByText("Сводка");
    const name = screen.getByLabelText("Название");

    fireEvent.change(name, { target: { value: "сводка" } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "задание" } });
    expect(screen.getByText("Действие с таким названием уже есть")).toBeDefined();
    expect(createButton().disabled).toBe(true);
    fireEvent.change(name, { target: { value: "Новое" } });
    expect(createButton().disabled).toBe(false);

    fireEvent.keyDown(hotkeyField(), { code: "KeyK", ctrlKey: true });
    expect(screen.getByText("это сочетание занято приложением")).toBeDefined();
    expect(createButton().disabled).toBe(true);
    fireEvent.keyDown(hotkeyField(), { code: "KeyJ", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("это сочетание уже у другого действия")).toBeDefined();
    fireEvent.keyDown(hotkeyField(), { key: "Backspace", code: "Backspace" });
    expect(hotkeyField().value).toBe("");
    expect(createButton().disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Расписание"), { target: { value: "понедельник" } });
    expect(screen.getByText("расписание не разобрано, нужно вроде «пн 10:00»")).toBeDefined();
    expect(createButton().disabled).toBe(true);
  });

  it("имя заняли файлом вне списка: подсказку даёт ответ Rust", async () => {
    fakeRust({ refuse: "name_taken" });
    open({ at: "/actions" });

    fireEvent.change(await screen.findByLabelText("Название"), { target: { value: "Отчёт" } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "задание" } });
    fireEvent.click(createButton());

    expect(await screen.findByText("Действие с таким названием уже есть")).toBeDefined();
  });

  it("правка переписывает файл: имя не меняется, своя клавиша не считается занятой", async () => {
    const rust = fakeRust();
    open({ at: "/actions" });

    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Изменить" }));

    expect(screen.getByRole("heading", { name: "Действие «Обзор изменений»" })).toBeDefined();
    expect(screen.queryByLabelText("Название")).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Задание агенту").value).toBe("Посмотри изменения");
    expect(hotkeyField().value).toBe("Ctrl+Shift+J");
    expect(screen.queryByText("это сочетание уже у другого действия")).toBeNull();
    fireEvent.keyDown(hotkeyField(), { code: "KeyS", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("это сочетание уже у другого действия")).toBeDefined();

    fireEvent.keyDown(hotkeyField(), { code: "KeyJ", ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "Посмотри изменения за неделю" } });
    fireEvent.change(screen.getByLabelText("Расписание"), { target: { value: "пт 18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(await screen.findByRole("heading", { name: "Новое действие" })).toBeDefined();
    expect(rust.written).toEqual([
      {
        path: "Обзор изменений.md",
        text: "---\nhotkey: Mod+Shift+J\nschedule: пт 18:00\n---\nПосмотри изменения за неделю\n",
      },
    ]);
    expect(await (await row("Обзор изменений")).findByText("Ctrl+Shift+J · по расписанию пт 18:00")).toBeDefined();
  });

  it("удаление спрашивает, после него действие пропадает, и его клавиша ничего не делает", async () => {
    const rust = fakeRust();
    open({ at: "/actions" });

    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Удалить" }));
    expect((await row("Обзор изменений")).getByText("Удалить действие?")).toBeDefined();
    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Отмена" }));
    expect(rust.deleted).toEqual([]);
    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Удалить" }));
    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(screen.queryByText("Обзор изменений")).toBeNull());
    expect(rust.deleted).toEqual(["Обзор изменений.md"]);

    hotkey("KeyJ");
    await settle();
    expect(rust.sent).toEqual([]);
    expect(rust.created).toEqual([]);
  });

  it("«Запустить» уводит в чат открытой сессии и шлёт туда задание", async () => {
    const rust = fakeRust();
    open();
    await openSession("Рефакторинг парсера");

    fireEvent.click(screen.getByRole("link", { name: "Действия" }));
    fireEvent.click((await row("Сводка")).getByRole("button", { name: "Запустить" }));

    await chatOf("Рефакторинг парсера");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toEqual({
      session: "s1",
      ...AGENT,
      text: `Сводка за ${today()}`,
      oversight: "ask",
    });
    expect(rust.created).toEqual([]);
  });

  it("список показывает клавишу и то, что не так, а без задания «Запустить» нет", async () => {
    fakeRust({ actions: [...ACTIONS, { path: "Кривое.md", text: "---\nhotkey: Shift+T\n---\nзадание\n" }] });
    open({ at: "/actions" });

    const empty = await row("Пустое");
    const crooked = await row("Кривое");

    expect(empty.getByText("Ctrl+Shift+E · нет задания, не запускается")).toBeDefined();
    expect(empty.queryByRole("button", { name: "Запустить" })).toBeNull();
    expect(crooked.getByText("Shift+T · клавиша не разобрана")).toBeDefined();
    expect((await row("Сводка")).getByText("Ctrl+Shift+S")).toBeDefined();
  });
});
