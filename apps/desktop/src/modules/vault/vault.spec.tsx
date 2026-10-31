import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VaultGate, VaultTree, useVaultSync } from "@/modules/vault";
import { treeStore } from "./store/tree.store";

type Entry = { kind: string; name: string; path: string; children?: Entry[] };

type CreateArgs = { parent: string; name: string; kind: "note" | "folder" };

type Disk = {
  status: unknown;
  tree: Entry[];
  // Что вернёт системный диалог выбора папки.
  picked?: unknown;
  // Что просили создать, по порядку.
  created?: CreateArgs[];
  // Отказ на создание, как его пришлёт Rust.
  refuse?: unknown;
};

// Кладёт созданное в дерево так, как его потом отдаст vault_tree.
function place(tree: Entry[], { parent, name, kind }: CreateArgs) {
  const fileName = kind === "note" ? `${name}.md` : name;
  const path = parent === "" ? fileName : `${parent}/${fileName}`;
  const entry: Entry = kind === "note" ? { kind, name: fileName, path } : { kind, name, path, children: [] };
  const folder = tree.find((item) => item.path === parent);

  (folder?.children ?? tree).push(entry);

  return path;
}

// Rust это граница процесса: подменяются его команды, а не модуль.
function fakeRust(disk: Disk) {
  disk.created = [];

  mockIPC(
    (command, args) => {
      switch (command) {
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
          return place(disk.tree, args as CreateArgs);
        default:
          throw new Error(`нет команды ${command}`);
      }
    },
    { shouldMockEvents: true },
  );

  return disk;
}

function Window() {
  useVaultSync();

  return (
    <>
      <VaultTree />
      <VaultGate>
        <p>редактор</p>
      </VaultGate>
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

const note = (path: string): Entry => ({ kind: "note", name: path.split("/").at(-1) ?? path, path });

const folder = (path: string, children: Entry[] = []): Entry => ({
  kind: "folder",
  name: path.split("/").at(-1) ?? path,
  path,
  children,
});

// Сначала окно отписывается от событий, потом подмена Rust уходит:
// в обратном порядке отписке не к кому обратиться. Отписка асинхронная,
// поэтому между ними пауза. Выделение и раскрытые папки живут, пока живёт
// окно, а здесь каждый тест это новое окно.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearMocks();
  treeStore.setState(() => ({ selected: null, expanded: [], draft: null }));
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
    expect(screen.queryByText("редактор")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать папку" }));

    expect(await screen.findByText("редактор")).toBeDefined();
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
    fireEvent.click(screen.getByRole("button", { name: "Новый файл" }));

    const field = nameField();
    expect(field.value).toBe("Без названия 1");
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "Без названия 1".length]);

    pressEnter();

    const created = await screen.findByRole("button", { name: "Без названия 1" });
    expect(disk.created).toEqual([{ parent: "Проекты", name: "Без названия 1", kind: "note" }]);
    expect(created.getAttribute("aria-current")).toBe("true");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("без выделения папка создаётся в корне, когда фокус уходит с поля", async () => {
    const disk = fakeRust({ status: { kind: "ready", path: "/notes" }, tree: [note("Идеи.md")] });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "Новая папка" }));
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

    fireEvent.click(await screen.findByRole("button", { name: "Новый файл" }));
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

    fireEvent.click(await screen.findByRole("button", { name: "Новый файл" }));
    rename("   ");
    pressEnter();
    expect(nameField()).toBeDefined();

    fireEvent.keyDown(nameField(), { key: "Escape" });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(disk.created).toEqual([]);
  });

  it("имя, занятое снаружи после чтения дерева, подсказывается по ответу Rust", async () => {
    const disk = fakeRust({
      status: { kind: "ready", path: "/notes" },
      tree: [],
      refuse: { kind: "conflict", code: "name_taken" },
    });
    launch();

    fireEvent.click(await screen.findByRole("button", { name: "Новый файл" }));
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

    fireEvent.contextMenu(screen.getByRole("navigation"));
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

    fireEvent.contextMenu(await screen.findByRole("navigation"));
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
