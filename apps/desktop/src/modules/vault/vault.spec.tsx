import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VaultGate, VaultTree, useVaultSync } from "@/modules/vault";

type Disk = {
  status: unknown;
  tree: unknown[];
  // Что вернёт системный диалог выбора папки.
  picked?: unknown;
};

// Rust это граница процесса: подменяются его команды, а не модуль.
function fakeRust(disk: Disk) {
  mockIPC(
    (command) => {
      switch (command) {
        case "vault_status":
          return disk.status;
        case "vault_tree":
          return disk.tree;
        case "vault_choose":
          disk.status = disk.picked ?? disk.status;
          return disk.status;
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

const note = (path: string) => ({ kind: "note", name: path.split("/").at(-1), path });

describe("хранилище", () => {
  // Сначала окно отписывается от событий, потом подмена Rust уходит:
  // в обратном порядке отписке не к кому обратиться. Отписка асинхронная,
  // поэтому между ними пауза.
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearMocks();
  });

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
      tree: [{ kind: "folder", name: "Проекты", path: "Проекты", children: [note("Проекты/sapien.md")] }],
    });
    launch();

    const folder = await screen.findByRole("button", { name: "Проекты" });
    expect(screen.queryByText("sapien")).toBeNull();

    fireEvent.click(folder);

    expect(folder.getAttribute("aria-expanded")).toBe("true");
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
