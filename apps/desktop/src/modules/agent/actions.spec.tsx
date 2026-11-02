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
import type { Oversight } from "./model/chat";
import type { Project, SessionInfo } from "./model/sessions";
import { chatStore, sessionStore } from "./store/chat.store";

type Sent = { session: string; model: string; text: string; oversight: Oversight };
type File = { path: string; text: string };

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };
const SITE: Project = { id: "p2", name: "сайт", path: "/Users/me/сайт", missing: false };
// Папка, которую человек выберет в системном диалоге «Добавить проект».
const DOCS: Project = { id: "p3", name: "документы", path: "/Users/me/документы", missing: false };

// Последняя сессия во втором проекте: новая сессия без открытой встаёт туда.
const SESSIONS: SessionInfo[] = [
  { id: "s1", project: "p1", title: "Рефакторинг парсера", updated: 3000 },
  { id: "s2", project: "p1", title: "Тесты окна", updated: 5000 },
  { id: "s3", project: "p2", title: "Лендинг", updated: 4000 },
];

// Действия лежат файлами в папке приложения: путь это имя файла.
const ACTIONS: File[] = [
  { path: "Обзор изменений.md", text: "---\nhotkey: Mod+Shift+J\nschedule:\n---\nПосмотри изменения\n" },
  { path: "Сводка.md", text: "---\nhotkey: Mod+Shift+S\n---\nСводка за {{today}}\n" },
  { path: "Пустое.md", text: "---\nhotkey: Mod+Shift+E\n---\n" },
];

// Rust за командами агента и действий. Ответ агента приходит сразу.
// refuse это код отказа actions_create.
function fakeRust({
  actions = ACTIONS,
  projects = [SAPIEN, SITE],
  refuse,
}: { actions?: File[]; projects?: Project[]; refuse?: string } = {}) {
  const rust = {
    projects: [...projects],
    sessions: SESSIONS.filter((session) => projects.some((project) => project.id === session.project)),
    actions: [...actions],
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
        };

        rust.created.push(session);
        rust.sessions = [...rust.sessions, session];
        return session;
      }
      case "agent_history":
        return [];
      case "agent_claude_status":
        return { state: "ready", version: "2.1.316" };
      case "agent_send": {
        const { session, model, text, oversight } = args as Sent;

        rust.sent.push({ session, model, text, oversight });
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
  chatStore.setState(() => ({ session: null, live: null, problem: null, open: null, askEdits: true }));
  sessionStore.setState(() => null);
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
      model: "claude-sonnet-5-5",
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
    expect(screen.getByText(/Такого действия нет/)).toBeDefined();
    press("Enter");

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toMatchObject({ session: "s1", text: "/погода" });
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
    expect(rust.sent).toEqual([{ session: "s1", model: "claude-sonnet-5-5", text: "Посмотри изменения", oversight: "ask" }]);
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

// Прошлый запуск неделю с лишним назад: окно запомнило его в своём хранилище.
function ranLongAgo() {
  const at = Date.now() - 8 * DAY;

  localStorage.setItem("sapien.actions.runs", JSON.stringify({ [DAILY.path]: { at, ran: true } }));

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
      model: "claude-sonnet-5-5",
      text: `Изменения с ${since} по ${today()}`,
      oversight: "away",
    });
    // Экран за действием не переключается.
    expect(screen.getByRole("heading", { name: "Выберите сессию" })).toBeDefined();

    cleanup();
    open();
    await screen.findByRole("heading", { name: "Выберите сессию" });
    await settle();
    expect(rust.sent).toHaveLength(1);
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
      model: "claude-sonnet-5-5",
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
