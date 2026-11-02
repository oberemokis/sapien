import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionsView } from "@/modules/agent";

type File = { path: string; text: string };

// Действия лежат файлами в папке приложения: путь это имя файла.
const ACTIONS: File[] = [
  { path: "Обзор изменений.md", text: "---\nhotkey: Mod+Shift+J\nschedule:\n---\nПосмотри изменения\n" },
  { path: "Сводка.md", text: "---\nhotkey: Mod+Shift+S\n---\nСводка за {{today}}\n" },
  { path: "Пустое.md", text: "---\nhotkey: Mod+Shift+E\n---\n" },
];

// Rust за командами действий. refuse это код отказа actions_create.
function fakeRust({ actions = ACTIONS, refuse }: { actions?: File[]; refuse?: string } = {}) {
  const rust = {
    actions: [...actions],
    written: [] as File[],
    deleted: [] as string[],
  };

  mockIPC((command, args) => {
    switch (command) {
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

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ActionsView />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
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
    open();

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
    open();

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
    open();
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
    open();

    fireEvent.change(await screen.findByLabelText("Название"), { target: { value: "Отчёт" } });
    fireEvent.change(screen.getByLabelText("Задание агенту"), { target: { value: "задание" } });
    fireEvent.click(createButton());

    expect(await screen.findByText("Действие с таким названием уже есть")).toBeDefined();
  });

  it("правка переписывает файл: имя не меняется, своя клавиша не считается занятой", async () => {
    const rust = fakeRust();
    open();

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

  it("удаление спрашивает, после него действие пропадает", async () => {
    const rust = fakeRust();
    open();

    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Удалить" }));
    expect((await row("Обзор изменений")).getByText("Удалить действие?")).toBeDefined();
    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Отмена" }));
    expect(rust.deleted).toEqual([]);
    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Удалить" }));
    fireEvent.click((await row("Обзор изменений")).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(screen.queryByText("Обзор изменений")).toBeNull());
    expect(rust.deleted).toEqual(["Обзор изменений.md"]);
  });

  it("список показывает клавишу и то, что не так", async () => {
    fakeRust({ actions: [...ACTIONS, { path: "Кривое.md", text: "---\nhotkey: Shift+T\n---\nзадание\n" }] });
    open();

    expect((await row("Пустое")).getByText("Ctrl+Shift+E · нет задания, не запускается")).toBeDefined();
    expect((await row("Кривое")).getByText("Shift+T · клавиша не разобрана")).toBeDefined();
    expect((await row("Сводка")).getByText("Ctrl+Shift+S")).toBeDefined();
  });
});
