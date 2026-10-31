import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataKeyNotice, SecuritySettings } from "@/modules/security";
import type { SecurityStatus } from "./model/security";

// Rust за командами безопасности: состояние и сколько раз просили
// начать с чистыми данными. resetFails роняет чистый старт.
function fakeRust(status: SecurityStatus, { resetFails = false } = {}) {
  const rust = { resets: 0 };

  mockIPC((command) => {
    switch (command) {
      case "security_status":
        return status;
      case "security_reset":
        rust.resets += 1;

        if (resetFails) {
          throw { kind: "unavailable", code: "data_unresettable" };
        }

        return "sealed";
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return rust;
}

// Окно: раздел «Безопасность» и окно о пропавшем ключе поверх, как
// в __root.tsx.
function launch() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SecuritySettings />
      <DataKeyNotice />
    </QueryClientProvider>,
  );
}

function row(title: string) {
  const heading = screen.getByText(title);

  return heading.closest("div.flex.items-center") as HTMLElement;
}

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
});

describe("безопасность", () => {
  it("данные зашифрованы, FileVault включён", async () => {
    fakeRust({ data: "sealed", system: "macos", disk: true });

    launch();

    await screen.findByText("Зашифрованы");
    expect(within(row("Данные приложения")).getByText(/Копия папки данных на другом компьютере не читается/)).toBeTruthy();
    expect(within(row("Шифрование диска")).getByText("Включено")).toBeTruthy();
    expect(screen.getByText("FileVault включён: заметки и остальные файлы на диске зашифрованы.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("шифрование диска выключено: раздел говорит об этом и как включить", async () => {
    fakeRust({ data: "sealed", system: "windows", disk: false });

    launch();

    expect(await screen.findByText("Выключено")).toBeTruthy();
    expect(screen.getByText(/BitLocker выключен, и заметки лежат на диске открытыми\. Включить: «Параметры»/)).toBeTruthy();
  });

  it("без хранилища паролей данные лежат открытыми, и раздел говорит почему", async () => {
    fakeRust({ data: "plain", system: "linux", disk: null });

    launch();

    expect(await screen.findByText("Без шифрования")).toBeTruthy();
    expect(screen.getByText(/Secret Service: GNOME Keyring или KWallet/)).toBeTruthy();
    expect(within(row("Шифрование диска")).getByText("Неизвестно")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ключ пропал: окно не закрывается само и предлагает начать с чистыми данными", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    const rust = fakeRust({ data: "lost", system: "macos", disk: true });

    launch();

    const dialog = await screen.findByRole("dialog", { name: "Данные приложения не читаются" });

    expect(within(dialog).getByText(/Ключ шифрования пропал из системного хранилища паролей/)).toBeTruthy();
    expect(within(dialog).getByText("Заметки не затронуты: это обычные файлы в папке хранилища.")).toBeTruthy();

    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Начать с чистыми данными" }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(rust.resets).toBe(1);
  });

  it("хранилище паролей не ответило: окно говорит, что можно перезапустить", async () => {
    fakeRust({ data: "locked", system: "linux", disk: true });

    launch();

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Если хранилище снова доступно, перезапустите приложение/)).toBeTruthy();
  });

  it("чистый старт не прошёл: причина на экране, повтор доступен", async () => {
    const rust = fakeRust({ data: "lost", system: "macos", disk: true }, { resetFails: true });

    launch();

    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Начать с чистыми данными" }));

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Начать с чистыми данными" })).toHaveProperty("disabled", false);
    expect(rust.resets).toBe(1);
  });
});
