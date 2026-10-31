import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileSearch,
  NoteTabs,
  NoteView,
  TagList,
  TagPanelSetting,
  VaultGate,
  VaultTree,
  restoreSession,
  setTemplateValues,
  useCreateNote,
  useFolderNotes,
  useNewFromTemplateSet,
  useVaultSync,
  type TemplateSet,
} from "@/modules/vault";
import type { MenuItem } from "@/core/ui/context-menu";
import { forgetNotes } from "./interactions/note";
import { closeHistory } from "./interactions/history";
import { closeSearch } from "./interactions/search";
import { DEFAULT_TEMPLATES } from "./model/templates";
import type { EditorProps, ReaderProps, Unsaved } from "./model/vault";
import { tagPanelStore } from "./store/tag-panel.store";
import { templatesStore } from "./store/templates.store";
import { EMPTY_TREE, treeStore } from "./store/tree.store";

type Entry = { kind: string; name: string; path: string; children?: Entry[]; closed?: boolean };

// Метка папки, закрытой для агента, как её ставит Rust.
function withClosed(tree: Entry[], folder: string, closed: boolean): Entry[] {
  return tree.map((item) => {
    if (item.path === folder) {
      return { ...item, closed };
    }

    return item.children === undefined ? item : { ...item, children: withClosed(item.children, folder, closed) };
  });
}

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
  // Журнал восстановления по пути заметки.
  journal?: Record<string, Unsaved>;
  // Что ушло в корзину, по порядку.
  trashed?: string[];
  // Версии заметок по пути, свежие первыми.
  history?: Record<string, Snapshot[]>;
  // Заметки из ссылок sapien://, которые Rust ещё не отдал окну.
  opened?: string[];
};

type Snapshot = { id: number; source: string; text: string };

const missing = { kind: "not_found", code: "note_missing" };

// Восстановление как в Rust: текущий текст уходит версией, удалённая
// заметка появляется снова.
function restoreVersion(files: Record<string, string>, history: Record<string, Snapshot[]>, path: string, id: number) {
  const versions = history[path] ?? [];
  const version = versions.find((item) => item.id === id);

  if (version === undefined) {
    throw { kind: "not_found", code: "version_missing" };
  }

  if (path in files) {
    versions.unshift({ id: Date.now(), source: "restore", text: files[path] ?? "" });
  }

  files[path] = version.text;
  return null;
}

function withoutEntry(tree: Entry[], entry: string): Entry[] {
  return tree
    .filter((item) => item.path !== entry)
    .map((item) => (item.children === undefined ? item : { ...item, children: withoutEntry(item.children, entry) }));
}

function findEntry(tree: Entry[], path: string): Entry | undefined {
  for (const item of tree) {
    const found = item.path === path ? item : findEntry(item.children ?? [], path);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

// Кладёт созданное в дерево так, как его потом отдаст vault_tree. Занятое
// имя Rust отклоняет, и подмена тоже.
function place(tree: Entry[], files: Record<string, string>, { parent, name, kind }: CreateArgs) {
  const fileName = kind === "note" ? `${name}.md` : name;
  const path = parent === "" ? fileName : `${parent}/${fileName}`;
  const entry: Entry = kind === "note" ? { kind, name: fileName, path } : { kind, name, path, children: [] };

  if (findEntry(tree, path) !== undefined) {
    throw { kind: "conflict", code: "name_taken" };
  }

  (findEntry(tree, parent)?.children ?? tree).push(entry);

  if (kind === "note") {
    files[path] = "";
  }

  return path;
}

// Rust это граница процесса: подменяются его команды, а не модуль.
function fakeRust(disk: Disk) {
  disk.created = [];
  disk.trashed = [];
  const files = (disk.files ??= {});
  const journal = (disk.journal ??= {});

  mockIPC(
    (command, args) => {
      const { path, text, base } = args as Unsaved;
      const { id } = args as { id: number };
      // Историю тест задаёт после запуска подмены.
      const history = (disk.history ??= {});

      switch (command) {
        case "vault_versions":
          return (history[path] ?? []).map((version) => ({ id: version.id, source: version.source }));
        case "vault_version":
          return history[path]?.find((version) => version.id === id)?.text;
        case "vault_restore":
          return restoreVersion(files, history, path, id);
        case "vault_deleted":
          return Object.keys(history).filter((note) => !(note in files));
        case "vault_read":
          if (!(path in files)) {
            throw missing;
          }

          return files[path];
        case "vault_write":
          journal[path] = { path, base, text };

          if (disk.full) {
            throw { kind: "unavailable", code: "note_unwritable" };
          }

          if (!(path in files)) {
            throw missing;
          }

          if (base !== null && files[path] !== base) {
            throw { kind: "conflict", code: "note_conflict" };
          }

          files[path] = text;
          delete journal[path];
          return null;
        case "vault_unsaved":
          return Object.values(journal);
        case "vault_forget_unsaved":
          delete journal[path];
          return null;
        case "vault_trash":
          disk.trashed?.push(path);
          disk.tree = withoutEntry(disk.tree, path);

          for (const file of Object.keys(files)) {
            if (file === path || file.startsWith(`${path}/`)) {
              delete files[file];
            }
          }

          return null;
        case "vault_close_for_agent":
          disk.tree = withClosed(disk.tree, path, (args as { closed: boolean }).closed);
          return null;
        case "vault_status":
          return disk.status;
        case "vault_tree":
          return structuredClone(disk.tree);
        case "vault_texts":
          return Object.entries(files).map(([file, content]) => ({ path: file, text: content }));
        case "vault_choose":
          disk.status = disk.picked ?? disk.status;
          return disk.status;
        case "vault_opened":
          return disk.opened?.splice(0) ?? [];
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
// правку, а CodeMirror проверяется в своём модуле. Теги в тексте он
// показывает кнопками, подсказку тегов строкой, а вставку кладёт
// на место курсора поля.
function TextEditor({ value, onChange, readOnly, focusRequest, insert, label, tags, onTagClick }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusRequest > 0) {
      ref.current?.focus();
    }
  }, [focusRequest]);

  useEffect(() => {
    const area = ref.current;

    if (area !== null && insert !== null) {
      onChange(area.value.slice(0, area.selectionStart) + insert + area.value.slice(area.selectionStart));
    }
  }, [insert, onChange]);

  return (
    <>
      <textarea
        ref={ref}
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
      {value.match(/#[\p{L}\p{N}_/-]+/gu)?.map((tag) => (
        <button key={tag} type="button" onClick={() => onTagClick(tag.slice(1))}>
          {tag}
        </button>
      ))}
      <output aria-label="подсказка тегов">{tags.join(" ")}</output>
    </>
  );
}

// Чтение здесь текст как есть и [[ссылки]] кнопками: отрисовка markdown
// проверяется в модуле редактора.
function TextReader({ value, label, hidden, findNote, onNoteClick }: ReaderProps) {
  return (
    <article aria-label={`чтение ${label}`} hidden={hidden}>
      <p>{value}</p>
      {[...value.matchAll(/\[\[([^\]]+)\]\]/g)].map(([link, target = ""]) => {
        const path = findNote(target);

        return (
          <button key={link} type="button" disabled={path === null} onClick={() => path !== null && onNoteClick(path)}>
            {link}
          </button>
        );
      })}
    </article>
  );
}

// Набор стандартных шаблонов соседа, как шаблоны задач у YouTrack.
const TASKS: TemplateSet = {
  folder: "Задачи",
  templates: [
    { name: "Баг", text: "---\nproject: {{project}}\n---\n# {{title}}\n" },
    { name: "Фича", text: "---\nproject: {{project}}\n---\n# {{title}}\n\n## Проверка\n" },
  ],
};

function Window({ noteMenu }: { noteMenu?: (path: string) => MenuItem[] }) {
  useVaultSync();
  const newTask = useNewFromTemplateSet(TASKS);

  return (
    <>
      <header>
        <NoteTabs onCreateStart={() => undefined} />
      </header>
      <aside aria-label="дерево">
        <VaultTree
          noteMenu={noteMenu}
          createMenu={(parent) => [{ label: "Новая задача", onSelect: () => void newTask(parent) }]}
        />
        <TagList />
      </aside>
      <main>
        <VaultGate>
          <NoteView editor={TextEditor} reader={TextReader} showFiles={() => undefined} />
        </VaultGate>
      </main>
      <FileSearch />
    </>
  );
}

function launch(noteMenu?: (path: string) => MenuItem[]) {
  const client = new QueryClient();

  return render(
    <QueryClientProvider client={client}>
      <Window noteMenu={noteMenu} />
    </QueryClientProvider>,
  );
}

// Соседний модуль, который держит свои файлы в папке хранилища.
function FolderOwner() {
  const folderNotes = useFolderNotes("Действия");
  const create = useCreateNote();

  return (
    <section aria-label="папка">
      {folderNotes?.map((entry) => (
        <p key={entry.path}>{entry.path}</p>
      ))}
      <button
        type="button"
        onClick={() => create.mutate({ folder: "Действия", name: "Сводка", text: "Собери сводку\n" })}
      >
        создать
      </button>
      <button
        type="button"
        onClick={() => create.mutate({ folder: "Действия/Свежее", name: "План", text: "План\n" })}
      >
        создать глубже
      </button>
    </section>
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
  closeHistory();
  templatesStore.setState(() => DEFAULT_TEMPLATES);
  tagPanelStore.setState(() => "open");
  setTemplateValues({});
  localStorage.clear();
  vi.useRealTimers();
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

  it("ссылка sapien:// открывает заметку и при запуске, и в открытом окне", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [note("план.md"), folder("Проекты", [note("Проекты/sapien.md")])],
      files: { "план.md": "раз", "Проекты/sapien.md": "два" },
      opened: ["план.md"],
    });
    launch();

    expect(await screen.findByRole("textbox", { name: "план" })).toHaveProperty("value", "раз");

    disk.opened = ["Проекты/sapien.md"];
    await act(() => emit("vault://open"));

    expect(await screen.findByRole("textbox", { name: "sapien" })).toHaveProperty("value", "два");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
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
    // Созданная заметка открылась, и курсор ушёл в её текст.
    await screen.findByRole("textbox", { name: "План" });

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

  it("меню заметки дополняют соседи, недоступный пункт помечен, у папки их пунктов нет", async () => {
    const chosen: string[] = [];
    fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [folder("Проекты"), note("идеи.md")] });
    launch((path) => [
      { label: "Сводка", onSelect: () => chosen.push(path) },
      { label: "Отчёт", disabled: true, hint: "нет сети", onSelect: () => chosen.push("недоступный") },
    ]);

    fireEvent.contextMenu(await inTree().findByRole("button", { name: "идеи" }));
    expect(screen.getByRole<HTMLButtonElement>("menuitem", { name: "Отчёт нет сети" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Сводка" }));
    expect(chosen).toEqual(["идеи.md"]);

    fireEvent.contextMenu(inTree().getByRole("button", { name: "Проекты" }));
    expect(screen.getByRole("menuitem", { name: "Новый файл" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "Сводка" })).toBeNull();
  });

  it("папку закрывают для агента из её меню, замок виден, открывают так же", async () => {
    fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [folder("Личное"), note("идеи.md")] });
    launch();

    fireEvent.contextMenu(await inTree().findByRole("button", { name: "Личное" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Закрыть для агента" }));

    const closed = await inTree().findByRole("button", { name: "Личное закрыта для агента" });

    fireEvent.contextMenu(inTree().getByRole("button", { name: "идеи" }));
    expect(screen.queryByRole("menuitem", { name: /для агента/ })).toBeNull();

    fireEvent.contextMenu(closed);
    fireEvent.click(screen.getByRole("menuitem", { name: "Открыть для агента" }));
    expect(await inTree().findByRole("button", { name: "Личное" })).toBeDefined();
  });

  it("заметка с текстом ложится в папку, которой ещё не было, список папки без вложенных", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [],
      files: { "Действия/Архив/давнее.md": "", "идеи.md": "" },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FolderOwner />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "создать" }));

    expect(await screen.findByText("Действия/Сводка.md")).toBeDefined();
    expect(disk.created).toEqual([
      { parent: "", name: "Действия", kind: "folder" },
      { parent: "Действия", name: "Сводка", kind: "note" },
    ]);
    expect(disk.files?.["Действия/Сводка.md"]).toBe("Собери сводку\n");
    expect(screen.getAllByRole("paragraph")).toHaveLength(1);

    // Во вложенную папку: есть «Действия», появляется только «Свежее».
    fireEvent.click(screen.getByRole("button", { name: "создать глубже" }));

    await waitFor(() => expect(disk.files?.["Действия/Свежее/План.md"]).toBe("План\n"));
    expect(disk.created?.slice(2)).toEqual([
      { parent: "", name: "Действия", kind: "folder" },
      { parent: "Действия", name: "Свежее", kind: "folder" },
      { parent: "Действия/Свежее", name: "План", kind: "note" },
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

function notes(files: Record<string, string>, journal: Record<string, Unsaved> = {}) {
  const disk = fakeRust({
    status: { kind: "ready", path: "/notes" },
    tree: [folder("Проекты", [note("Проекты/план.md")]), note("идеи.md")],
    files,
    journal,
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

  it("правка снаружи посреди своей: ни одна не затёрта, видны обе, своя остаётся по выбору", async () => {
    const { files } = notes({ "идеи.md": "было" });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });
    type("идеи", "моя правка");

    files["идеи.md"] = "правка агента";
    await act(() => emit("vault://changed"));

    expect(await screen.findByText(/Файл изменили снаружи/, undefined, SAVED)).toBeDefined();
    expect(files["идеи.md"]).toBe("правка агента");
    expect(editorText("идеи")).toBe("моя правка");
    expect(screen.getByRole("region", { name: "Версия на диске" }).textContent).toBe("правка агента");

    fireEvent.click(screen.getByRole("button", { name: "Оставить мою" }));

    await waitFor(() => expect(files["идеи.md"]).toBe("моя правка"));
    expect(screen.queryByText(/Файл изменили снаружи/)).toBeNull();
  });

  it("версия с диска вместо своей: правка уходит и из журнала, следующая пишется от новой", async () => {
    const { files, disk } = notes({ "идеи.md": "было" });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });
    type("идеи", "моя правка");
    files["идеи.md"] = "правка агента";

    fireEvent.click(await screen.findByRole("button", { name: "Взять с диска" }, SAVED));

    await waitFor(() => expect(editorText("идеи")).toBe("правка агента"));
    expect(disk.journal).toEqual({});

    type("идеи", "правка агента и моя");
    await waitFor(() => expect(files["идеи.md"]).toBe("правка агента и моя"), SAVED);
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
    expect(document.activeElement).toBe(editor);
    expect(screen.getByRole("heading", { name: "Встреча" })).toBeDefined();
  });
});

function ideasHistory() {
  return within(screen.getByRole("dialog", { name: "История версий «идеи»" }));
}

describe("история версий", () => {
  const halloween = Date.UTC(2026, 9, 31, 9, 0);

  it("кнопка над заметкой показывает версии и разницу, восстановление берёт и несохранённую правку", async () => {
    const { files, disk } = notes({ "идеи.md": "а\nб" });
    disk.history = { "идеи.md": [{ id: halloween, source: "edit", text: "а\nстарое" }] };
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });
    type("идеи", "а\nб\nв");
    fireEvent.click(screen.getByRole("button", { name: "История версий" }));

    expect(await ideasHistory().findByText("До правки")).toBeDefined();
    const compare = ideasHistory().getByRole("region", { name: "Версия против текущего текста" });
    expect(await within(compare).findByText("старое")).toBeDefined();
    expect(within(compare).getByText("в")).toBeDefined();

    fireEvent.click(ideasHistory().getByRole("button", { name: "Восстановить" }));

    await waitFor(() => expect(files["идеи.md"]).toBe("а\nстарое"));
    expect(disk.history["идеи.md"]?.[0]).toMatchObject({ source: "restore", text: "а\nб\nв" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(editorText("идеи")).toBe("а\nстарое"));
  });

  it("удалённая заметка находится среди удалённых и возвращается", async () => {
    const { files, disk } = notes({ "идеи.md": "идеи" });
    disk.history = { "Архив/старое.md": [{ id: halloween, source: "trash", text: "вернись" }] };
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "Удалённые заметки" }));
    fireEvent.click(await screen.findByRole("option", { name: /старое/ }));

    const dialog = await screen.findByRole("dialog", { name: "История версий «старое»" });
    expect(await within(dialog).findByText("До удаления")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Восстановить" }));

    await waitFor(() => expect(files["Архив/старое.md"]).toBe("вернись"));
    expect(await screen.findByRole("heading", { name: "старое" })).toBeDefined();
  });

  it("удалённых с историей нет: так и сказано", async () => {
    notes({ "идеи.md": "идеи" });
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "Удалённые заметки" }));

    expect(await screen.findByText("Удалённых заметок с историей нет")).toBeDefined();
  });
});

describe("журнал и корзина", () => {
  const left = { "идеи.md": { path: "идеи.md", base: "было", text: "не успело" } };

  it("правка, не дошедшая до файла в прошлый раз, возвращается по согласию", async () => {
    const { files, disk } = notes({ "идеи.md": "было" }, { ...left });
    launch();

    expect(await screen.findByText(/остались правки, которые не записались в файлы: идеи/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Вернуть" }));

    await screen.findByRole("textbox", { name: "идеи" });
    expect(editorText("идеи")).toBe("не успело");
    await waitFor(() => expect(files["идеи.md"]).toBe("не успело"));
    expect(disk.journal).toEqual({});
    expect(screen.queryByText(/остались правки/)).toBeNull();
  });

  it("от правки из журнала можно отказаться, файл остаётся как был", async () => {
    const { files, disk } = notes({ "идеи.md": "было" }, { ...left });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "Отказаться" }));

    await waitFor(() => expect(screen.queryByText(/остались правки/)).toBeNull());
    expect(disk.journal).toEqual({});
    expect(files["идеи.md"]).toBe("было");
  });

  it("удалённое из дерева уходит в корзину, вкладки внутри него закрываются", async () => {
    const disk = workspace();
    launch();

    await openFromTree("Проекты", "план");
    fireEvent.click(inTree().getByRole("button", { name: "идеи" }), mod);
    expect(tabs()).toHaveLength(2);

    fireEvent.contextMenu(inTree().getByRole("button", { name: "Проекты" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Переместить в корзину" }));

    await waitFor(() => expect(inTree().queryByRole("button", { name: "Проекты" })).toBeNull());
    expect(disk.trashed).toEqual(["Проекты"]);
    expect(tabs()).toHaveLength(1);

    fireEvent.keyDown(inTree().getByRole("button", { name: "идеи" }), { key: "Backspace", ...mod });

    await waitFor(() => expect(inTree().queryByRole("button", { name: "идеи" })).toBeNull());
    expect(disk.trashed).toEqual(["Проекты", "идеи.md"]);
    expect(tabs()).toEqual([]);

    // Пустое место дерева удалять нечего.
    fireEvent.contextMenu(inTree().getByRole("navigation"));
    expect(screen.queryByRole("menuitem", { name: "Переместить в корзину" })).toBeNull();
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

function tabs() {
  return screen.queryAllByRole("tab").map((tab) => tab.getAttribute("aria-label"));
}

function activeTab() {
  return screen.queryAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.getAttribute("aria-label");
}

function workspace() {
  return fakeRust({
    status: { kind: "ready", path: "/notes" },
    tree: [folder("Встречи", [note("Встречи/план.md")]), folder("Проекты", [note("Проекты/план.md")]), note("идеи.md")],
    files: { "Встречи/план.md": "встреча", "Проекты/план.md": "проект", "идеи.md": "идеи" },
  });
}

// В testing-library нет auxClick, событие средней кнопки собирается руками.
function middleClick(element: Element) {
  fireEvent(element, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
}

async function openFromTree(...names: string[]) {
  for (const name of names) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- клики по очереди, как человек
    fireEvent.click(await inTree().findByRole("button", { name }));
  }
}

describe("вкладки", () => {
  it("клик заменяет файл вкладки, ⌘клик открывает новую, открытый не повторяется", async () => {
    workspace();
    launch();
    await openFromTree("Встречи", "Проекты");

    fireEvent.click(inTree().getByRole("button", { name: "идеи" }));
    fireEvent.click(within(inTree().getAllByRole("listitem")[0] as HTMLElement).getByRole("button", { name: "план" }));
    expect(tabs()).toEqual(["план"]);

    fireEvent.click(inTree().getByRole("button", { name: "идеи" }), mod);
    expect(tabs()).toEqual(["план", "идеи"]);

    fireEvent.click(within(inTree().getAllByRole("listitem")[0] as HTMLElement).getByRole("button", { name: "план" }));
    expect(tabs()).toEqual(["план", "идеи"]);
    expect(activeTab()).toBe("план");
  });

  it("закрытие крестиком, средней кнопкой и ⌘W, последняя оставляет подсказку", async () => {
    workspace();
    launch();
    await openFromTree("идеи", "Встречи");
    fireEvent.click(inTree().getByRole("button", { name: "план" }), mod);
    fireEvent.click(inTree().getByRole("button", { name: "Проекты" }));
    middleClick(within(inTree().getAllByRole("listitem")[2] as HTMLElement).getByRole("button", { name: "план" }));
    expect(tabs()).toEqual(["идеи", "план, Встречи", "план, Проекты"]);

    fireEvent.click(screen.getByRole("button", { name: "Закрыть «идеи»" }));
    middleClick(screen.getByRole("tab", { name: "план, Встречи" }));
    expect(tabs()).toEqual(["план"]);

    fireEvent.keyDown(window, { code: "KeyW", ...mod });
    expect(tabs()).toEqual([]);
    expect(await screen.findByText("Выберите заметку")).toBeDefined();
  });

  it("Ctrl+Tab ходит по вкладкам по кругу и ставит курсор в текст", async () => {
    workspace();
    launch();
    await openFromTree("идеи", "Встречи");
    fireEvent.click(inTree().getByRole("button", { name: "план" }), mod);
    expect(activeTab()).toBe("план");

    fireEvent.keyDown(window, { code: "Tab", ctrlKey: true });
    expect(activeTab()).toBe("идеи");
    expect(document.activeElement).toBe(await screen.findByRole("textbox", { name: "идеи" }));

    fireEvent.keyDown(window, { code: "Tab", ctrlKey: true, shiftKey: true });
    expect(activeTab()).toBe("план");
  });

  it("уход на другую вкладку сохраняет правку сразу, а её текст живёт дальше", async () => {
    const disk = workspace();
    launch();
    await openFromTree("идеи");
    fireEvent.click(inTree().getByRole("button", { name: "Встречи" }));
    fireEvent.click(inTree().getByRole("button", { name: "план" }), mod);
    fireEvent.click(screen.getByRole("tab", { name: "идеи" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "идеи" }), { target: { value: "идеи и ещё" } });

    fireEvent.click(screen.getByRole("tab", { name: "план" }));

    await waitFor(() => expect(disk.files?.["идеи.md"]).toBe("идеи и ещё"), { timeout: 200 });
    fireEvent.click(screen.getByRole("tab", { name: "идеи" }));
    expect((screen.getByRole("textbox", { name: "идеи" }) as HTMLTextAreaElement).value).toBe("идеи и ещё");
  });

  it("файл открытой вкладки удалили: вкладка помечена, текст на месте", async () => {
    const disk = workspace();
    launch();
    await openFromTree("идеи");
    await screen.findByRole("textbox", { name: "идеи" });

    disk.tree = disk.tree.filter((entry) => entry.path !== "идеи.md");
    delete disk.files?.["идеи.md"];
    await act(() => emit("vault://changed"));

    await waitFor(() => expect(screen.getByRole("tab", { name: "идеи" }).getAttribute("title")).toBe("Файла больше нет на диске"));
    expect((screen.getByRole("textbox", { name: "идеи" }) as HTMLTextAreaElement).value).toBe("идеи");
  });

  it("вкладки переживают перезапуск, кроме тех, чьих файлов уже нет", async () => {
    const disk = workspace();
    const first = launch();
    await openFromTree("идеи", "Встречи");
    fireEvent.click(inTree().getByRole("button", { name: "план" }), mod);
    first.unmount();

    disk.tree = disk.tree.filter((entry) => entry.path !== "идеи.md");
    treeStore.setState(() => EMPTY_TREE);
    restoreSession();
    launch();

    await waitFor(() => expect(tabs()).toEqual(["план"]));
    expect(activeTab()).toBe("план");
    expect(await screen.findByRole("textbox", { name: "план" })).toBeDefined();
  });

  it("файл переименовали снаружи во время набора: вкладка на месте, правка в новом файле", async () => {
    const disk = workspace();
    const files = disk.files ?? {};
    launch();
    await openFromTree("идеи", "Встречи");
    fireEvent.click(inTree().getByRole("button", { name: "план" }), mod);
    fireEvent.click(screen.getByRole("tab", { name: "идеи" }));
    const editor = await screen.findByRole("textbox", { name: "идеи" });
    // Пауза в наборе ещё не прошла, правка не на диске.
    fireEvent.change(editor, { target: { value: "идеи и ещё" } });

    disk.tree = [...disk.tree.filter((entry) => entry.path !== "идеи.md"), note("мысли.md")];
    files["мысли.md"] = files["идеи.md"] ?? "";
    delete files["идеи.md"];
    await act(() => emit("vault://changed", [{ from: "идеи.md", to: "мысли.md" }]));

    expect(tabs()).toEqual(["мысли", "план"]);
    expect(activeTab()).toBe("мысли");
    // Тот же редактор: курсор и история правок не пропали.
    expect(screen.getByRole("textbox", { name: "мысли" })).toBe(editor);
    await waitFor(() => expect(files["мысли.md"]).toBe("идеи и ещё"));
    expect(files).not.toHaveProperty("идеи.md");
    expect(disk.journal).toEqual({});
  });

  it("папку переименовали снаружи: её вкладки, дерево и запомненное на новых путях", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [folder("Встречи", [note("Встречи/итоги.md"), note("Встречи/план.md")]), note("идеи.md")],
      files: { "Встречи/итоги.md": "итоги", "Встречи/план.md": "план", "идеи.md": "идеи" },
    });
    const first = launch();
    await openFromTree("Встречи", "план");
    fireEvent.click(inTree().getByRole("button", { name: "итоги" }), mod);

    disk.tree = [folder("Созвоны", [note("Созвоны/итоги.md"), note("Созвоны/план.md")]), note("идеи.md")];
    disk.files = Object.assign(disk.files ?? {}, { "Созвоны/итоги.md": "итоги", "Созвоны/план.md": "план" });
    delete disk.files["Встречи/итоги.md"];
    delete disk.files["Встречи/план.md"];
    await act(() => emit("vault://changed", [{ from: "Встречи", to: "Созвоны" }]));

    expect(tabs()).toEqual(["план", "итоги"]);
    expect(within(screen.getByRole("navigation", { name: "Путь к заметке" })).getByText("Созвоны")).toBeDefined();
    // Раскрытая папка осталась раскрытой под новым именем.
    expect(await inTree().findByRole("button", { name: "итоги" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();

    first.unmount();
    treeStore.setState(() => EMPTY_TREE);
    restoreSession();
    launch();

    await waitFor(() => expect(tabs()).toEqual(["план", "итоги"]));
    expect(await screen.findByRole("textbox", { name: "итоги" })).toHaveProperty("value", "итоги");
  });
});

function reading(label: string) {
  return screen.queryByRole("article", { name: `чтение ${label}` });
}

function readingButton() {
  return screen
    .getAllByRole("button", { name: "Режим чтения" })
    .find((button) => button.closest("[hidden]") === null) as HTMLElement;
}

function pressModE() {
  fireEvent.keyDown(window, { code: "KeyE", key: "e", ...mod });
}

describe("режим чтения", () => {
  it("⌘E и кнопка переключают вкладку, правка не теряется, курсор возвращается в текст", async () => {
    workspace();
    launch();
    await openFromTree("идеи");
    const editor = await screen.findByRole("textbox", { name: "идеи" });
    fireEvent.change(editor, { target: { value: "идеи и [[план]]" } });

    pressModE();

    expect(reading("идеи")?.textContent).toContain("идеи и [[план]]");
    expect(editor.closest("[hidden]")).not.toBeNull();
    expect(readingButton().getAttribute("aria-pressed")).toBe("true");
    // В чтении вставлять шаблон некуда.
    expect(screen.queryByRole("button", { name: "Вставить шаблон" })).toBeNull();

    fireEvent.click(readingButton());

    expect(reading("идеи")?.closest("[hidden]")).not.toBeNull();
    expect(editor.closest("[hidden]")).toBeNull();
    expect(editorText("идеи")).toBe("идеи и [[план]]");
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it("режим помнит вкладка: другая вкладка в правке, после перезапуска чтение на месте", async () => {
    workspace();
    const first = launch();
    await openFromTree("идеи");
    pressModE();
    fireEvent.click(inTree().getByRole("button", { name: "Встречи" }));
    fireEvent.click(inTree().getByRole("button", { name: "план" }), mod);

    expect(await screen.findByRole("textbox", { name: "план" })).toBeDefined();
    expect(reading("план")).toBeNull();

    first.unmount();
    treeStore.setState(() => EMPTY_TREE);
    restoreSession();
    launch();

    await waitFor(() => expect(tabs()).toEqual(["идеи", "план"]));
    fireEvent.click(screen.getByRole("tab", { name: "идеи" }));
    expect(await screen.findByRole("article", { name: "чтение идеи" })).toBeDefined();
  });

  it("[[заметка]] из чтения открывает заметку в той же вкладке, тоже в чтении", async () => {
    const disk = workspace();
    (disk.files ?? {})["идеи.md"] = "см. [[Встречи/план]] и [[нет такой]]";
    launch();
    await openFromTree("идеи");
    await screen.findByRole("textbox", { name: "идеи" });
    pressModE();

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "[[нет такой]]" }).disabled).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "[[Встречи/план]]" }));

    await waitFor(() => expect(tabs()).toEqual(["план"]));
    expect(await screen.findByRole("article", { name: "чтение план" })).toBeDefined();
  });

  it("правка файла снаружи видна в чтении без перезапуска", async () => {
    const disk = workspace();
    launch();
    await openFromTree("идеи");
    await screen.findByRole("textbox", { name: "идеи" });
    pressModE();
    expect(reading("идеи")?.textContent).toBe("идеи");

    (disk.files ?? {})["идеи.md"] = "идеи с другого устройства";
    await act(() => emit("vault://changed"));

    await waitFor(() => expect(reading("идеи")?.textContent).toContain("идеи с другого устройства"));
  });
});

function tagged() {
  return fakeRust({
    status: { kind: "ready", path: "/notes" },
    tree: [folder("Встречи", [note("Встречи/ретро.md")]), note("план.md"), note("идеи.md")],
    files: {
      "Встречи/ретро.md": "#Работа созвон #встреча",
      "план.md": "---\ntags: [работа/sapien]\n---\n# План",
      "идеи.md": "`#код` и # Заголовок",
    },
  });
}

function tagsRegion() {
  return screen.queryByRole("region", { name: "Теги" });
}

// Кнопки тегов из списка, без заголовка. Свёрнутый список не виден и пуст.
function tagButtons() {
  const list = within(tagsRegion() as HTMLElement).queryByRole("list");

  if (list === null) {
    return [];
  }

  return within(list)
    .queryAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
}

function tagsHeader() {
  return within(tagsRegion() as HTMLElement).getByRole("button", { name: "Теги" });
}

describe("теги", () => {
  it("раздел тегов: все теги с числом заметок, клик показывает заметки с тегом", async () => {
    tagged();
    launch();

    await waitFor(() =>
      expect(tagButtons()).toEqual([
        "#встреча, заметок: 1",
        "#Работа, заметок: 2",
        "#работа/sapien, заметок: 1",
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "#Работа, заметок: 2" }));

    expect(search()).toHaveProperty("value", "#Работа ");
    expect(options()).toEqual(["план", "ретроВстречи"]);
  });

  it("несколько тегов в поиске сужают выдачу, чужой тег не находит ничего", async () => {
    tagged();
    launch();
    await waitFor(() => expect(tagButtons()).toHaveLength(3));

    fireEvent.keyDown(window, { code: "KeyK", ...mod });
    query("#работа #встреча");
    expect(options()).toEqual(["ретроВстречи"]);

    query("#отпуск");
    expect(options()).toEqual([]);
    expect(screen.getByText("Ничего не найдено")).toBeDefined();
  });

  it("клик по тегу в тексте ищет заметки, правка обновляет список тегов", async () => {
    const disk = tagged();
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "идеи" }));
    await screen.findByRole("textbox", { name: "идеи" });
    expect(screen.getByRole("status", { name: "подсказка тегов" }).textContent).toBe(
      "встреча Работа работа/sapien",
    );

    type("идеи", "идеи на #отпуск");
    await waitFor(() => expect(disk.files?.["идеи.md"]).toBe("идеи на #отпуск"), SAVED);
    await waitFor(() => expect(tagButtons()).toContain("#отпуск, заметок: 1"));

    fireEvent.click(screen.getByRole("button", { name: "#отпуск" }));
    expect(options()).toEqual(["идеи"]);
    fireEvent.keyDown(search(), { key: "Escape" });

    // Тег ушёл из последней заметки и пропал из списка.
    type("идеи", "идеи");
    await waitFor(() => expect(tagButtons()).not.toContain("#отпуск, заметок: 1"), SAVED);
  });

  it("заголовок сворачивает раздел до одной строки, и это переживает перезапуск", async () => {
    tagged();
    const first = launch();
    await waitFor(() => expect(tagButtons()).toHaveLength(3));

    fireEvent.click(tagsHeader());

    expect(tagsHeader().getAttribute("aria-expanded")).toBe("false");
    expect(tagButtons()).toEqual([]);
    first.unmount();

    tagPanelStore.setState(() => "open");
    restoreSession();
    launch();

    await waitFor(() => expect(tagsHeader().getAttribute("aria-expanded")).toBe("false"));
    expect(tagButtons()).toEqual([]);

    fireEvent.click(tagsHeader());
    expect(tagsHeader().getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(tagButtons()).toHaveLength(3));
  });

  it("меню заголовка убирает раздел, а «Внешний вид» возвращает его развёрнутым", async () => {
    tagged();
    launch();
    render(<TagPanelSetting />);
    await waitFor(() => expect(tagButtons()).toHaveLength(3));
    const show = screen.getByRole("checkbox", { name: "Показывать панель тегов" });
    expect(show).toHaveProperty("checked", true);

    fireEvent.contextMenu(tagsHeader());
    fireEvent.click(screen.getByRole("menuitem", { name: "Скрыть панель тегов" }));

    expect(tagsRegion()).toBeNull();
    expect(show).toHaveProperty("checked", false);
    expect(localStorage.getItem("sapien.tags.panel")).toBe("hidden");

    fireEvent.click(show);

    expect(tagsHeader().getAttribute("aria-expanded")).toBe("true");
    expect(tagButtons()).toHaveLength(3);
  });
});

function templated() {
  return fakeRust({
    status: { kind: "ready", path: "/notes" },
    tree: [folder("Встречи"), folder("Шаблоны", [note("Шаблоны/Встреча.md")]), note("план.md")],
    files: {
      "Шаблоны/Встреча.md": "# {{title}}\n{{date}} {{time}} {{foo}} #встреча",
      "план.md": "начало\nконец",
    },
  });
}

function picker() {
  return screen.getByRole("combobox", { name: "Выбор шаблона" });
}

// Минуты не меняются посреди теста.
function freezeClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 29, 14, 5));
}

describe("шаблоны", () => {
  it("новый файл из шаблона: меню папки, шаблон, имя, файл с подстановками", async () => {
    const disk = templated();
    freezeClock();
    launch();

    fireEvent.contextMenu(await inTree().findByRole("button", { name: "Встречи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Новый файл из шаблона" }));
    expect(options()).toEqual(["ВстречаШаблоны"]);
    fireEvent.keyDown(picker(), { key: "Enter" });

    rename("Ретро");
    pressEnter();

    expect(await screen.findByRole("textbox", { name: "Ретро" })).toBeDefined();
    expect(disk.files?.["Встречи/Ретро.md"]).toBe("# Ретро\n2026-10-29 14:05 {{foo}} #встреча");
    // Тег шаблона у новой заметки есть, у самого шаблона нет.
    await waitFor(() => expect(tagButtons()).toEqual(["#встреча, заметок: 1"]));
  });

  it("вставка шаблона идёт на место курсора и ничего не затирает, формат даты из настроек", async () => {
    const disk = templated();
    freezeClock();
    localStorage.setItem("sapien.templates", JSON.stringify({ dateFormat: "DD.MM.YYYY" }));
    restoreSession();
    launch();

    fireEvent.click(await inTree().findByRole("button", { name: "план" }));
    const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "план" });
    editor.setSelectionRange(7, 7);

    fireEvent.click(screen.getByRole("button", { name: "Вставить шаблон" }));
    fireEvent.keyDown(picker(), { key: "Enter" });

    await waitFor(() => expect(editorText("план")).toBe("начало\n# план\n29.10.2026 14:05 {{foo}} #встречаконец"));
    await waitFor(() => expect(disk.files?.["план.md"]).toBe(editorText("план")), SAVED);
  });

  it("набор шаблонов ложится один раз: свой шаблон не перезаписан, удалённый не возвращается", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [
        folder("Встречи"),
        folder("Шаблоны", [note("Шаблоны/Встреча.md"), folder("Шаблоны/Задачи", [note("Шаблоны/Задачи/Баг.md")])]),
      ],
      files: { "Шаблоны/Встреча.md": "# {{title}}\n", "Шаблоны/Задачи/Баг.md": "---\nproject: {{project}}\n---\nсвой баг\n" },
    });
    setTemplateValues({ project: "SAP" });
    launch();

    fireEvent.contextMenu(await inTree().findByRole("button", { name: "Встречи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Новая задача" }));

    await waitFor(() => expect(options()).toEqual(["БагШаблоны/Задачи", "ФичаШаблоны/Задачи"]));
    expect(disk.files?.["Шаблоны/Задачи/Баг.md"]).toBe("---\nproject: {{project}}\n---\nсвой баг\n");
    expect(disk.files?.["Шаблоны/Задачи/Фича.md"]).toBe(TASKS.templates[1]?.text);

    fireEvent.keyDown(picker(), { key: "ArrowDown" });
    fireEvent.keyDown(picker(), { key: "Enter" });
    rename("Вход");
    pressEnter();

    expect(await screen.findByRole("textbox", { name: "Вход" })).toBeDefined();
    expect(disk.files?.["Встречи/Вход.md"]).toBe("---\nproject: SAP\n---\n# Вход\n\n## Проверка\n");

    // Человек удалил «Фичу»: следующая задача её не возвращает.
    disk.tree = withoutEntry(disk.tree, "Шаблоны/Задачи/Фича.md");
    delete disk.files?.["Шаблоны/Задачи/Фича.md"];
    await act(() => emit("vault://changed", null));
    fireEvent.contextMenu(inTree().getByRole("button", { name: "Встречи" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Новая задача" }));

    await waitFor(() => expect(options()).toEqual(["БагШаблоны/Задачи"]));
    expect(disk.files?.["Шаблоны/Задачи/Фича.md"]).toBeUndefined();
  });

  it("шаблонов нет: вместо списка подсказка, как завести первый", async () => {
    notes({ "идеи.md": "" });
    launch();

    fireEvent.contextMenu(await inTree().findByRole("navigation"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Новый файл из шаблона" }));

    expect(options()).toEqual([]);
    expect(screen.getByText("Шаблонов пока нет. Создайте заметку в папке «Шаблоны», и она появится здесь.")).toBeDefined();
  });
});
