import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSettings, useMeetingTasks } from "@/modules/agent";

const KEY = "sk-ant-api03-очень-секретно-WXYZ";

type Claude = { state: string; version: string | null };

const READY: Claude = { state: "ready", version: "2.1.316" };

// Системное хранилище паролей и Claude Code за командами Rust. kept: false
// это Linux без Secret Service.
function fakeRust(kept = true, claude: Claude = { state: "missing", version: null }) {
  const keychain: { value: string | null; calls: string[]; claude: Claude; meeting: unknown } = {
    value: null,
    calls: [],
    claude,
    meeting: null,
  };

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
      case "agent_claude_status":
        return keychain.claude;
      case "agent_meeting_tasks":
        keychain.meeting = args;
        return [];
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return keychain;
}

// Свой кеш запросов на каждый тест.
function providers() {
  const client = new QueryClient();

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function open() {
  render(<AgentSettings />, { wrapper: providers() });
}

function keyField() {
  return screen.getByLabelText<HTMLInputElement>("Ключ API", { selector: "input[type=password]" });
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

    await screen.findByText(/Ключ хранится/);
    fireEvent.change(keyField(), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(screen.getByText(/продержится до закрытия приложения/)).toBeDefined());
    expect(screen.getByText(/заканчивается на WXYZ/)).toBeDefined();
  });
});

function radio(name: string) {
  return screen.getByRole<HTMLInputElement>("radio", { name });
}

describe("подписка Claude", () => {
  it("Claude Code вошёл по подписке: она выбрана, видна версия", async () => {
    fakeRust(true, READY);
    open();

    expect(await screen.findByText("Вход по подписке Claude. Версия 2.1.316.")).toBeDefined();
    expect(radio("Подписка Claude").checked).toBe(true);
  });

  it("без Claude Code раздел говорит, как его поставить, а агент идёт ключом", async () => {
    fakeRust();
    open();

    expect(await screen.findByText(/Не найден. Поставьте его командой/)).toBeDefined();
    expect(radio("Ключ API").checked).toBe(true);
  });

  it("вход не выполнен, а после входа «Проверить снова» видит подписку", async () => {
    const rust = fakeRust(true, { state: "logged_out", version: "2.1.316" });
    open();

    expect(await screen.findByText(/Вход не выполнен/)).toBeDefined();

    rust.claude = READY;
    fireEvent.click(screen.getByRole("button", { name: "Проверить снова" }));

    expect(await screen.findByText(/Вход по подписке Claude/)).toBeDefined();
    expect(radio("Подписка Claude").checked).toBe(true);
  });
});

// Каким способом уходит разбор встречи, когда человек способ не выбирал.
async function meetingMethod(claude: Claude) {
  const rust = fakeRust(true, claude);
  const { result } = renderHook(() => useMeetingTasks(), { wrapper: providers() });

  result.current.run("Встречи/планёрка.md");
  await waitFor(() => expect(rust.meeting).not.toBeNull());

  return (rust.meeting as { method: string }).method;
}

describe("задачи из встречи", () => {
  it("идут подпиской, когда Claude Code вошёл по подписке, иначе ключом", async () => {
    expect(await meetingMethod(READY)).toBe("subscription");
    expect(await meetingMethod({ state: "not_subscription", version: "2.1.316" })).toBe("key");
    expect(await meetingMethod({ state: "unsupported", version: null })).toBe("key");
  });
});
