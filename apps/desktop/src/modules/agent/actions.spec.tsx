import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionSettings, AgentChat, useActions } from "@/modules/agent";

type Context = { path: string | null; selection: string };
type Sent = { model: string; text: string; context: Context };
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
        const { model, text, context } = args as Sent;

        sent.push({ model, text, context });
        return null;
      }
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
    expect(sent[0]).toEqual({ model: "claude-sonnet-5-5", text: "Сводка по эпику", context: CONTEXT });
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
    expect(sent[0]).toMatchObject({ text: "Заведи задачу из этой заметки", context: CONTEXT });

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
        return Promise.resolve();
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
});
