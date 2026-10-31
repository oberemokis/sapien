import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionSettings, AgentChat, useActions } from "@/modules/agent";

type Context = { path: string | null; selection: string };
type Sent = { model: string; text: string; context: Context; oversight?: string };
type Note = { path: string; text: string };

// Rust за командами чата: ключ задан, история пуста, ответ приходит сразу.
function fakeRust() {
  const sent: Sent[] = [];

  mockIPC((command, args) => {
    switch (command) {
      case "secret_status":
        return { ending: "WXYZ", kept: true };
      case "agent_history":
        return [];
      case "agent_send": {
        const { model, text, context, oversight } = args as Sent;

        sent.push({ model, text, context, oversight });
        return null;
      }
      case "agent_attach":
        return false;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return sent;
}

const NOTES: Note[] = [
  { path: "Действия/Сводка.md", text: "---\nintegrations: [youtrack]\nhotkey: Mod+Shift+S\n---\nСводка по эпику\n" },
  { path: "Действия/Заметка из задачи.md", text: "---\nhotkey: Mod+Shift+J\n---\nЗаведи задачу из этой заметки\n" },
  { path: "Действия/Пустое.md", text: "---\nhotkey: Mod+Shift+E\n---\n" },
];

const CONTEXT: Context = { path: "Проекты/план.md", selection: "пункт про релиз" };

// Страница, как в окне: действия из заметок папки, чат справа. YouTrack
// подключён или нет по выбору теста.
function open({ notes = NOTES, youtrack = true } = {}) {
  const onRun = vi.fn();

  function Page() {
    const check = useMemo(() => ({ youtrack: () => Promise.resolve(youtrack) }), []);
    const actions = useActions({ notes, context: CONTEXT, check, onRun });

    return <AgentChat context={CONTEXT} actions={actions} />;
  }

  const router = createRouter({
    routeTree: createRootRoute({ component: Page }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return onRun;
}

async function type(text: string) {
  fireEvent.change(await screen.findByLabelText("Сообщение агенту"), { target: { value: text } });
}

function press(key: string) {
  fireEvent.keyDown(screen.getByLabelText("Сообщение агенту"), { key });
}

// В тестах не macOS: Mod это Ctrl.
function hotkey(code: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, ctrlKey: true, shiftKey: true, cancelable: true }));
  });
}

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
  localStorage.clear();
});

const DAY = 24 * 60 * 60 * 1000;

// Сводка каждый день в полночь: срок прошёл сегодня, что бы ни показывали часы.
const DAILY: Note = {
  path: "Действия/Сводка по эпику.md",
  text: "---\nintegrations: [youtrack]\nschedule: 0:00\nepic: SAP-1\n---\nСводка по {{epic}} с {{since}} по {{today}}\n",
};

function ranLongAgo() {
  localStorage.setItem("sapien.actions.runs", JSON.stringify({ [DAILY.path]: { at: Date.now() - 8 * DAY, ran: true } }));
}

function runs() {
  return JSON.parse(localStorage.getItem("sapien.actions.runs") ?? "{}");
}

describe("действия по расписанию", () => {
  it("срок прошёл при закрытом приложении: действие уходит при открытии, без открытой заметки, за период с прошлого запуска", async () => {
    const sent = fakeRust();
    ranLongAgo();
    const since = new Date(runs()[DAILY.path].at).toLocaleDateString("sv-SE");
    const onRun = open({ notes: [DAILY] });

    await waitFor(() => expect(sent).toHaveLength(1));
    // Человека рядом нет: агент правит без вопросов и решает сам.
    expect(sent[0]).toEqual({
      model: "claude-sonnet-5-5",
      text: `Сводка по SAP-1 с ${since} по ${new Date().toLocaleDateString("sv-SE")}`,
      context: { path: null, selection: "" },
      oversight: "away",
    });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(runs()[DAILY.path].ran).toBe(true);

    // Запуск запомнился: второй раз за тот же срок действие не уходит.
    cleanup();
    open({ notes: [DAILY] });
    await screen.findByLabelText("Сообщение агенту");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
  });

  it("новое действие с расписанием только замечается и не уходит сразу", async () => {
    const sent = fakeRust();
    open({ notes: [DAILY] });

    await waitFor(() => expect(runs()[DAILY.path]).toMatchObject({ ran: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(0);
  });

  it("без сети срок ждёт, окно говорит, что действие отложено, а с сетью оно уходит само", async () => {
    const sent = fakeRust();
    ranLongAgo();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    open({ notes: [DAILY] });

    expect(await screen.findByText(/Отложено до появления сети и подключённого YouTrack: Сводка по эпику/)).toBeDefined();
    expect(sent).toHaveLength(0);

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/Отложено/)).toBeNull());
  });

  it("YouTrack не подключён: действие по расписанию отложено, а не потеряно", async () => {
    const sent = fakeRust();
    ranLongAgo();
    open({ notes: [DAILY], youtrack: false });

    expect(await screen.findByText(/Отложено до появления сети/)).toBeDefined();
    expect(sent).toHaveLength(0);
    expect(runs()[DAILY.path].at).toBeLessThan(Date.now() - 7 * DAY);
  });
});

describe("действия в чате", () => {
  it("«/» показывает действия с заданием, стрелки выбирают, Enter запускает с тем, что открыто", async () => {
    const sent = fakeRust();
    const onRun = open();

    await type("/");
    const list = screen.getByRole("listbox", { name: "Действия" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Заметка из задачиCtrl+Shift+J",
      "СводкаCtrl+Shift+S",
    ]);

    press("ArrowDown");
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("Сводка");
    press("Enter");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ model: "claude-sonnet-5-5", text: "Сводка по эпику", context: CONTEXT, oversight: "ask" });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Сообщение агенту").value).toBe("");
  });

  it("текст после «/» сужает список, без совпадений Enter шлёт его сообщением", async () => {
    const sent = fakeRust();
    open();

    await type("/зам");
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await type("/погода");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/Такого действия нет/)).toBeDefined();
    press("Enter");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.text).toBe("/погода");
  });

  it("горячая клавиша запускает действие, клавиша удалённого действия ничего не делает", async () => {
    const sent = fakeRust();
    open();
    await screen.findByLabelText("Сообщение агенту");

    hotkey("KeyJ");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ text: "Заведи задачу из этой заметки", context: CONTEXT, oversight: "ask" });

    // У действия без задания клавиша не срабатывает.
    hotkey("KeyE");
    cleanup();

    open({ notes: NOTES.filter((note) => !note.path.includes("Заметка")) });
    await screen.findByLabelText("Сообщение агенту");
    hotkey("KeyJ");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(1);
  });

  it("без сети действия помечены и не запускаются", async () => {
    const sent = fakeRust();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const onRun = open();

    await type("/");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Заметка из задачинет сети",
      "Сводканет сети",
    ]);
    press("Enter");

    // Клавиша показывает панель чата: там видно, что сети нет. Список
    // и Enter её не звали.
    expect(onRun).not.toHaveBeenCalled();
    hotkey("KeyJ");
    expect(onRun).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(0);
  });

  it("действию нужен YouTrack, а он не подключён: работа не начинается, причина ведёт в настройки", async () => {
    const sent = fakeRust();
    open({ youtrack: false });
    await screen.findByLabelText("Сообщение агенту");

    hotkey("KeyS");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Действию нужен YouTrack");
    expect(within(alert).getByRole("link", { name: "Подключить" }).getAttribute("href")).toBe(
      "/settings/integrations",
    );
    expect(sent).toHaveLength(0);
  });
});

// Раздел настроек с хранилищем за create: refuse это код отказа Rust.
function settings({ refuse }: { refuse?: string } = {}) {
  const created: { name: string; text: string }[] = [];
  const opened: string[] = [];

  render(
    <ActionSettings
      notes={NOTES}
      create={(name, text) => {
        if (refuse !== undefined) {
          return Promise.reject({ kind: "conflict", code: refuse });
        }

        created.push({ name, text });
        return Promise.resolve(`Действия/${name}.md`);
      }}
      open={(path) => opened.push(path)}
    />,
  );

  return { created, opened };
}

function create() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Создать" });
}

describe("раздел «Действия» в настройках", () => {
  it("новое действие ложится файлом с шапкой, форма пустеет", async () => {
    const { created } = settings();

    fireEvent.change(screen.getByLabelText("Название"), { target: { value: " Отчёт " } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "Собери отчёт" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "YouTrack" }));
    fireEvent.keyDown(screen.getByLabelText("Горячая клавиша"), { code: "KeyY", ctrlKey: true, shiftKey: true });
    expect(screen.getByLabelText<HTMLInputElement>("Горячая клавиша").value).toBe("Ctrl+Shift+Y");

    fireEvent.click(create());

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      name: "Отчёт",
      text: "---\nintegrations: [youtrack]\nhotkey: Mod+Shift+Y\n---\nСобери отчёт\n",
    });
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Название").value).toBe(""));
  });

  it("занятое название и занятая клавиша подсказаны, сохранение не проходит", () => {
    settings();

    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "сводка" } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "задание" } });
    expect(screen.getByText("Действие с таким названием уже есть")).toBeDefined();
    expect(create().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Новое" } });
    expect(create().disabled).toBe(false);

    const field = screen.getByLabelText("Горячая клавиша");
    fireEvent.keyDown(field, { code: "KeyK", ctrlKey: true });
    expect(screen.getByText("это сочетание занято приложением")).toBeDefined();
    expect(create().disabled).toBe(true);

    fireEvent.keyDown(field, { code: "KeyJ", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("это сочетание уже у другого действия")).toBeDefined();

    fireEvent.keyDown(field, { key: "Backspace", code: "Backspace" });
    expect(screen.getByLabelText<HTMLInputElement>("Горячая клавиша").value).toBe("");
    expect(create().disabled).toBe(false);
  });

  it("имя заняли файлом вне списка: подсказку даёт ответ Rust", async () => {
    settings({ refuse: "name_taken" });

    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Отчёт" } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "задание" } });
    fireEvent.click(create());

    expect(await screen.findByText("Действие с таким названием уже есть")).toBeDefined();
  });

  it("список показывает клавишу, интеграции и что не так, «Открыть» ведёт в файл", () => {
    const { opened } = settings();

    expect(screen.getByText("Ctrl+Shift+S · YouTrack")).toBeDefined();
    expect(screen.getByText("Ctrl+Shift+E · нет задания, не запускается")).toBeDefined();

    fireEvent.click(screen.getAllByRole("button", { name: "Открыть" })[0] as HTMLElement);
    expect(opened).toEqual(["Действия/Заметка из задачи.md"]);
  });

  it("готовую сводку по эпику добавляют одной кнопкой, и она открывается, чтобы вписать эпик", async () => {
    const { created, opened } = settings();

    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));

    await waitFor(() => expect(opened).toEqual(["Действия/Сводка по эпику.md"]));
    expect(created[0]?.name).toBe("Сводка по эпику");
    expect(created[0]?.text).toMatch(/^---\nintegrations: \[youtrack\]\nhotkey:\nschedule: Mon 10:00\nepic:\n---\n/);
  });
});
