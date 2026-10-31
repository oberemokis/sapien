import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FileSearch, NoteView, VaultGate, VaultTree, useVaultSync } from "@/modules/vault";
import { forgetNotes } from "./interactions/note";
import { closeSearch } from "./interactions/search";
import type { EditorProps } from "./model/vault";
import { EMPTY_TREE, treeStore } from "./store/tree.store";

type Entry = { kind: string; name: string; path: string; children?: Entry[] };

type CreateArgs = { parent: string; name: string; kind: "note" | "folder" };

type Disk = {
  status: unknown;
  tree: Entry[];
  // Текст заметок по пути.
  files?: Record<string, string>;
  // Что вернёт системный диалог выбора папки.
  picked?: unknown;
  // Что просили создать, по порядку.
  created?: CreateArgs[];
  // Отказ на создание, как его пришлёт Rust.
  refuse?: unknown;
  // Запись падает, как на полном диске.
  full?: boolean;
};

const missing = { kind: "not_found", code: "note_missing" };

// Кладёт созданное в дерево так, как его потом отдаст vault_tree.
function place(tree: Entry[], files: Record<string, string>, { parent, name, kind }: CreateArgs) {
  const fileName = kind === "note" ? `${name}.md` : name;
  const path = parent === "" ? fileName : `${parent}/${fileName}`;
  const entry: Entry = kind === "note" ? { kind, name: fileName, path } : { kind, name, path, children: [] };
  const folder = tree.find((item) => item.path === parent);

  (folder?.children ?? tree).push(entry);

  if (kind === "note") {
    files[path] = "";
  }

  return path;
}

// Rust это граница процесса: подменяются его команды, а не модуль.
function fakeRust(disk: Disk) {
  disk.created = [];
  const files = (disk.files ??= {});

  mockIPC(
    (command, args) => {
      const { path, text } = args as { path: string; text: string };

      switch (command) {
        case "vault_read":
          if (!(path in files)) {
            throw missing;
          }

          return files[path];
        case "vault_write":
          if (disk.full) {
            throw { kind: "unavailable", code: "note_unwritable" };
          }

          if (!(path in files)) {
            throw missing;
          }

          files[path] = text;
          return null;
        case "vault_status":
          return disk.status;
        case "vault_tree":
          return structuredClone(disk.tree);
        case "vault_choose":
          disk.status = disk.picked ?? disk.status;
          return disk.status;
        case "vault_create":
          if (disk.refuse !== undefined) {
            throw disk.refuse;
          }

          disk.created?.push(args as CreateArgs);
          return place(disk.tree, files, args as CreateArgs);
        default:
          throw new Error(`нет команды ${command}`);
      }
    },
    { shouldMockEvents: true },
  );

  return disk;
}

// Редактор здесь простое поле: хранилище отдаёт ему текст и принимает
// правку, а CodeMirror проверяется в своём модуле.
function TextEditor({ value, onChange, readOnly, focusOnMount, label }: EditorProps) {
  return (
    <textarea
      aria-label={label}
      data-focus-on-mount={focusOnMount || undefined}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Window() {
  useVaultSync();

  return (
    <>
      <aside aria-label="дерево">
        <VaultTree />
      </aside>
      <main>
        <VaultGate>
          <NoteView editor={TextEditor} showFiles={() => undefined} />
        </VaultGate>
      </main>
      <FileSearch />
    </>
  );
}

function launch() {
  const client = new QueryClient();

  return render(
    <QueryClientProvider client={client}>
      <Window />
    </QueryClientProvider>,
  );
}

// Кнопки «Новый файл» есть и над деревом, и в пустой середине окна.
function inTree() {
  return within(screen.getByRole("complementary", { name: "дерево" }));
}

const note = (path: string): Entry => ({ kind: "note", name: path.split("/").at(-1) ?? path, path });

const folder = (path: string, children: Entry[] = []): Entry => ({
  kind: "folder",
  name: path.split("/").at(-1) ?? path,
  path,
  children,
});

// Сначала окно отписывается от событий, потом подмена Rust уходит:
// в обратном порядке отписке не к кому обратиться. Отписка асинхронная,
// поэтому между ними пауза. Выделение, раскрытые папки и несохранённое
// живут, пока живёт окно, а здесь каждый тест это новое окно.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearMocks();
  treeStore.setState(() => EMPTY_TREE);
  forgetNotes();
  closeSearch();
  localStorage.clear();
});

describe("хранилище", () => {

  it("первый запуск просит папку, выбранная открывается деревом", async () => {
    fakeRust({
      status: { kind: "none" },
      tree: [note("план.md")],
      picked: { kind: "ready", path: "/Users/me/Заметки" },
    });
    launch();

    expect(await screen.findByRole("heading", { name: "Где хранить заметки?" })).toBeDefined();
    expect(screen.queryByText("Выберите заметку")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать папку" }));

    expect(await screen.findByText("Выберите заметку")).toBeDefined();
    expect(await screen.findByText("план")).toBeDefined();
  });

  it("закрытый без выбора диалог оставляет всё как было", async () => {
    fakeRust({ status: { kind: "none" }, tree: [] });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "Выбрать папку" }));

    expect(await screen.findByRole("heading", { name: "Где хранить заметки?" })).toBeDefined();
  });

  it("пропавшая папка названа, и её предлагают выбрать заново", async () => {
    fakeRust({ status: { kind: "missing", path: "/Users/me/Заметки" }, tree: [] });
    launch();

    expect(await screen.findByText(/Папки \/Users\/me\/Заметки больше нет на месте/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Выбрать папку" })).toBeDefined();
  });

  it("файл, добавленный снаружи, появляется без перезапуска", async () => {
    const disk = fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [note("план.md")] });
    launch();
    await screen.findByText("план");

    disk.tree = [note("план.md"), note("встреча.md")];
    await act(() => emit("vault://changed"));

    expect(await screen.findByText("встреча")).toBeDefined();
  });

  it("папка раскрывается и показывает вложенное", async () => {
    fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [folder("Проекты", [note("Проекты/sapien.md")])],
    });
    launch();

    const row = await screen.findByRole("button", { name: "Проекты" });
    expect(screen.queryByText("sapien")).toBeNull();

    fireEvent.click(row);

    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("sapien")).toBeDefined();
  });

  it("отказ Rust показывает ошибку с повтором, а не пустое окно", async () => {
    mockIPC(() => {
      throw { kind: "unavailable", code: "config_dir_unavailable" };
    });
    launch();

    expect(await screen.findByRole("heading", { name: "Не удалось открыть хранилище" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDefined();
  });
});

// happy-dom представляется Linux, но тест не должен от этого зависеть.
const mod = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };

function nameField() {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Имя" });
}

function rename(value: string) {
  fireEvent.change(nameField(), { target: { value } });
}

function pressEnter() {
  fireEvent.keyDown(nameField(), { key: "Enter" });
}

describe("создание в дереве", () => {
  it("кнопка создаёт файл в выделенной папке под свободным именем", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [folder("Проекты", [note("Проекты/Без названия.md")])],
    });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "Проекты" }));
    fireEvent.click(inTree().getByRole("button", { name: "Новый файл" }));

    const field = nameField();
    expect(field.value).toBe("Без названия 1");
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "Без названия 1".length]);

    pressEnter();

    const created = await screen.findByRole("button", { name: "Без названия 1" });
    expect(disk.created).toEqual([{ parent: "Проекты", name: "Без названия 1", kind: "note" }]);
    expect(created.getAttribute("aria-current")).toBe("true");
    expect(screen.queryByRole("textbox", { name: "Имя" })).toBeNull();
  });

  it("без выделения папка создаётся в корне, когда фокус уходит с поля", async () => {
    const disk = fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [note("Идеи.md")] });
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "Новая папка" }));
    rename("Архив");
    fireEvent.blur(nameField());

    expect(await screen.findByRole("button", { name: "Архив" })).toBeDefined();
    expect(disk.created).toEqual([{ parent: "", name: "Архив", kind: "folder" }]);
  });

  it.each([
    ["занятое имя", "идеи", "Такое имя в этой папке уже есть"],
    ["запрещённый символ", "итоги: октябрь", 'Нельзя использовать / \\ : * ? " < > |'],
  ])("%s подсказывается, Enter не проходит, введённое остаётся", async (_, name, hint) => {
    const disk = fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [note("Идеи.md")] });
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "Новый файл" }));
    rename(name);
    pressEnter();

    expect(screen.getByText(hint)).toBeDefined();
    expect(nameField().value).toBe(name);
    expect(nameField().getAttribute("aria-invalid")).toBe("true");
    expect(disk.created).toEqual([]);
  });

  it("пустое имя не проходит, Escape отменяет создание", async () => {
    const disk = fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [] });
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "Новый файл" }));
    rename("   ");
    pressEnter();
    expect(nameField()).toBeDefined();

    fireEvent.keyDown(nameField(), { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Имя" })).toBeNull();
    expect(disk.created).toEqual([]);
  });

  it("имя, занятое снаружи после чтения дерева, подсказывается по ответу Rust", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [],
      refuse: { kind: "conflict", code: "name_taken" },
    });
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "Новый файл" }));
    pressEnter();

    expect(await screen.findByText("Такое имя в этой папке уже есть")).toBeDefined();
    expect(nameField().value).toBe("Без названия");

    disk.refuse = { kind: "unavailable", code: "vault_unwritable" };
    rename("Встреча");
    expect(screen.queryByText("Такое имя в этой папке уже есть")).toBeNull();
    pressEnter();

    expect(await screen.findByText("Не удалось создать, попробуйте ещё раз")).toBeDefined();
  });

  it("правый клик по папке создаёт внутри неё, по пустому месту в корне", async () => {
    const disk = fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [folder("Проекты")] });
    launch();

    fireEvent.contextMenu(await screen.findByRole("button", { name: "Проекты" }), { clientX: 20, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Новый файл" }));
    expect(screen.queryByRole("menu")).toBeNull();
    rename("План");
    pressEnter();
    await screen.findByRole("button", { name: "План" });

    fireEvent.contextMenu(inTree().getByRole("navigation"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Новая папка" }));
    rename("Архив");
    pressEnter();
    await screen.findByRole("button", { name: "Архив" });

    expect(disk.created).toEqual([
      { parent: "Проекты", name: "План", kind: "note" },
      { parent: "", name: "Архив", kind: "folder" },
    ]);
  });

  it("Escape закрывает меню, а не что-то под ним", async () => {
    fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [] });
    launch();

    fireEvent.contextMenu(await inTree().findByRole("navigation"));
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Новый файл" }));

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.activeElement?.dispatchEvent(escape);
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
  });

  it("⌘N создаёт файл рядом с выделенной заметкой", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [folder("Проекты", [note("Проекты/sapien.md")])],
    });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "Проекты" }));
    fireEvent.click(screen.getByRole("button", { name: "sapien" }));
    fireEvent.keyDown(window, { code: "KeyN", ...mod });
    rename("Встреча");
    pressEnter();

    await screen.findByRole("button", { name: "Встреча" });
    expect(disk.created).toEqual([{ parent: "Проекты", name: "Встреча", kind: "note" }]);
  });
});

function type(label: string, text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value: text } });
}

function editorText(label: string) {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: label }).value;
}

// Пауза в наборе, после которой правка уходит на диск, с запасом.
const SAVED = { timeout: 1500 };

function notes(files: Record<string, string>) {
  const disk = fakeRust({
    status: { kind: "ready", path: "/notes" },
    tree: [folder("Проекты", [note("Проекты/план.md")]), note("идеи.md")],
    files,
  });

  return { files, disk };
}

describe("открытая заметка", () => {
  it("клик по файлу открывает его, правка сохраняется сама", async () => {
    const { files } = notes({ "Проекты/план.md": "# План", "идеи.md": "" });
    launch();
    expect(await screen.findByText("Выберите заметку")).toBeDefined();

    fireEvent.click(await screen.findByRole("button", { name: "Проекты" }));
    fireEvent.click(screen.getByRole("button", { name: "план" }));

    expect(await screen.findByRole("heading", { name: "план" })).toBeDefined();
    await screen.findByRole("textbox", { name: "план" });
    expect(editorText("план")).toBe("# План");
    expect(screen.getByRole("button", { name: "план" }).getAttribute("aria-current")).toBe("true");

    type("план", "# План\n\n- [ ] созвон");

    await waitFor(() => expect(files["Проекты/план.md"]).toBe("# План\n\n- [ ] созвон"), SAVED);
  });

  it("переход к другому файлу посреди правки сохраняет её сразу", async () => {
    const { files } = notes({ "Проекты/план.md": "план", "идеи.md": "идеи" });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });
    type("идеи", "идеи и ещё одна");
    fireEvent.click(screen.getByRole("button", { name: "Проекты" }));
    fireEvent.click(screen.getByRole("button", { name: "план" }));

    // Раньше паузы в наборе: запись ушла по переходу, а не по таймеру.
    await waitFor(() => expect(files["идеи.md"]).toBe("идеи и ещё одна"), { timeout: 200 });
    expect(await screen.findByRole("textbox", { name: "план" })).toBeDefined();
  });

  it("сохранить не удалось: ошибка видна, правка цела и уходит повтором", async () => {
    const { files, disk } = notes({ "идеи.md": "было" });
    disk.full = true;
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });
    type("идеи", "стало");

    expect(await screen.findByText(/Не удалось сохранить/, undefined, SAVED)).toBeDefined();
    expect(editorText("идеи")).toBe("стало");
    expect(files["идеи.md"]).toBe("было");

    disk.full = false;
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() => expect(files["идеи.md"]).toBe("стало"));
    expect(screen.queryByText(/Не удалось сохранить/)).toBeNull();
  });

  it("файл изменили снаружи: редактор подхватывает новое", async () => {
    const { files } = notes({ "идеи.md": "было" });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });

    files["идеи.md"] = "дописали в Obsidian";
    await act(() => emit("vault://changed"));

    await waitFor(() => expect(editorText("идеи")).toBe("дописали в Obsidian"));
  });

  it("несохранённая правка побеждает изменение снаружи", async () => {
    const { files } = notes({ "идеи.md": "было" });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });
    type("идеи", "моя правка");

    files["идеи.md"] = "правка агента";
    await act(() => emit("vault://changed"));

    expect(editorText("идеи")).toBe("моя правка");
    await waitFor(() => expect(files["идеи.md"]).toBe("моя правка"), SAVED);
    expect(editorText("идеи")).toBe("моя правка");
  });

  it("файл удалили снаружи: сообщение, а текст остаётся на экране", async () => {
    const { files, disk } = notes({ "идеи.md": "важное" });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });

    delete files["идеи.md"];
    disk.tree = [];
    await act(() => emit("vault://changed"));

    expect(await screen.findByText(/Файла больше нет на диске/)).toBeDefined();
    expect(editorText("идеи")).toBe("важное");
    expect(screen.getByRole("textbox", { name: "идеи" }).hasAttribute("readonly")).toBe(true);
  });

  it("пустая середина создаёт файл, и он открывается с курсором в тексте", async () => {
    notes({});
    launch();

    fireEvent.click(await within(screen.getByRole("main")).findByRole("button", { name: "Новый файл" }));
    rename("Встреча");
    pressEnter();

    const editor = await screen.findByRole("textbox", { name: "Встреча" });
    expect(editor.getAttribute("data-focus-on-mount")).toBe("true");
    expect(screen.getByRole("heading", { name: "Встреча" })).toBeDefined();
  });
});

function vault() {
  return fakeRust({
    status: { kind: "ready", path: "/notes" },
    tree: [
      folder("Встречи", [note("Встречи/план.md")]),
      folder("Проекты", [note("Проекты/план.md"), note("Проекты/Презентация.md")]),
      note("Ёлка.md"),
    ],
    files: { "Встречи/план.md": "", "Проекты/план.md": "", "Проекты/Презентация.md": "слайды", "Ёлка.md": "" },
  });
}

function search() {
  return screen.getByRole("combobox", { name: "Поиск файла" });
}

function query(text: string) {
  fireEvent.change(search(), { target: { value: text } });
}

function options() {
  return screen.queryAllByRole("option").map((option) => option.textContent);
}

describe("поиск файла", () => {
  it("⌘K ищет нечётко, Enter открывает найденное", async () => {
    vault();
    launch();
    await inTree().findByRole("button", { name: "Встречи" });

    fireEvent.keyDown(window, { code: "KeyK", ...mod });
    query("прзнт");

    expect(options()).toEqual(["ПрезентацияПроекты"]);
    expect(screen.getByRole("option").querySelectorAll("mark")).toHaveLength(3);

    fireEvent.keyDown(search(), { key: "Enter" });

    expect(await screen.findByRole("textbox", { name: "Презентация" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Презентация" }).getAttribute("aria-current")).toBe("true");
  });

  it("одинаковые имена различаются папкой, «е» находит «ё»", async () => {
    vault();
    launch();
    fireEvent.click(await inTree().findByRole("button", { name: /Поиск/ }));

    query("ПЛАН");
    expect(options().toSorted()).toEqual(["планВстречи", "планПроекты"]);

    query("елка");
    expect(options()).toEqual(["Ёлка"]);
  });

  it("пустой запрос показывает недавно открытые, свежие сверху", async () => {
    vault();
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "Ёлка" }));
    fireEvent.click(screen.getByRole("button", { name: "Проекты" }));
    fireEvent.click(screen.getByRole("button", { name: "Презентация" }));
    fireEvent.keyDown(window, { code: "KeyK", ...mod });

    expect(screen.getByText("Недавние")).toBeDefined();
    expect(options()).toEqual(["ПрезентацияПроекты", "Ёлка"]);
  });

  it("ничего не нашлось: файл создаётся в корне и открывается", async () => {
    const disk = vault();
    launch();
    fireEvent.click(await within(screen.getByRole("main")).findByRole("button", { name: "Открыть файл" }));

    query("Ретро");
    expect(screen.getByText("Ничего не найдено")).toBeDefined();
    expect(options()).toEqual(["Создать файл «Ретро»"]);

    fireEvent.keyDown(search(), { key: "Enter" });

    expect(await screen.findByRole("textbox", { name: "Ретро" })).toBeDefined();
    expect(disk.created).toEqual([{ parent: "", name: "Ретро", kind: "note" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape закрывает поиск, и фокус возвращается туда, где был", async () => {
    vault();
    launch();
    const trigger = await inTree().findByRole("button", { name: /Поиск/ });
    trigger.focus();

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(search());

    fireEvent.keyDown(search(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("удалённый снаружи файл следующий поиск уже не находит", async () => {
    const disk = vault();
    launch();
    await inTree().findByRole("button", { name: "Ёлка" });

    disk.tree = disk.tree.filter((entry) => entry.path !== "Ёлка.md");
    await act(() => emit("vault://changed"));
    await waitFor(() => expect(inTree().queryByRole("button", { name: "Ёлка" })).toBeNull());

    fireEvent.keyDown(window, { code: "KeyK", ...mod });
    query("елка");

    expect(screen.getByText("Ничего не найдено")).toBeDefined();
  });
});
