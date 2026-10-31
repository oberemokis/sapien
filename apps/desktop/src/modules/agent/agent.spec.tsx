import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSettings } from "@/modules/agent";

const KEY = "sk-ant-api03-очень-секретно-WXYZ";

// Системное хранилище паролей за командами Rust. kept: false это Linux
// без Secret Service.
function fakeRust(kept = true) {
  const keychain: { value: string | null; calls: string[] } = { value: null, calls: [] };

  function status() {
    return { ending: keychain.value?.slice(-4) ?? null, kept };
  }

  mockIPC((command, args) => {
    keychain.calls.push(command);
    const { value } = args as { value?: string };

    switch (command) {
      case "secret_status":
        return status();
      case "secret_set":
        keychain.value = value?.trim() ?? null;
        return status();
      case "secret_delete":
        keychain.value = null;
        return null;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return keychain;
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentSettings />
    </QueryClientProvider>,
  );
}

function keyField() {
  return screen.getByLabelText<HTMLInputElement>("Ключ API");
}

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("ключ модели", () => {
  it("ключ уходит в Rust, поле пустеет, окно видит только конец ключа", async () => {
    const keychain = fakeRust();
    open();
    await screen.findByText(/Ключ хранится в системном хранилище паролей/);

    fireEvent.change(keyField(), { target: { value: KEY } });
    fireEvent.keyDown(keyField(), { key: "Enter" });

    expect(keyField().value).toBe("");
    expect(await screen.findByText(/Задан, заканчивается на WXYZ/)).toBeDefined();
    expect(keychain.value).toBe(KEY);
    expect(document.body.innerHTML).not.toContain("очень-секретно");
  });

  it("«Удалить» стирает ключ, после этого его снова можно задать", async () => {
    const keychain = fakeRust();
    keychain.value = KEY;
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));

    expect(await screen.findByText(/Ключ хранится в системном хранилище паролей/)).toBeDefined();
    expect(keychain.value).toBeNull();
    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
  });

  it("пустой ключ не отправляется", async () => {
    const keychain = fakeRust();
    open();
    await screen.findByText(/Ключ хранится/);

    fireEvent.change(keyField(), { target: { value: "   " } });
    fireEvent.keyDown(keyField(), { key: "Enter" });

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Сохранить" }).disabled).toBe(true);
    expect(keychain.calls).not.toContain("secret_set");
  });

  it("без системного хранилища предупреждает, что ключ не переживёт перезапуск", async () => {
    fakeRust(false);
    open();

    fireEvent.change(await screen.findByLabelText("Ключ API"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(screen.getByText(/продержится до закрытия приложения/)).toBeDefined());
    expect(screen.getByText(/заканчивается на WXYZ/)).toBeDefined();
  });
});
