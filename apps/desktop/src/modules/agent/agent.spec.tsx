import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSettings } from "@/modules/agent";
import type { ClaudeStatus } from "./model/chat";
import { modelStore } from "./store/model.store";

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

// Claude Code на устройстве за командой Rust. Состояние можно сменить
// посреди теста: так человек входит в терминале, пока окно открыто.
function fakeRust(claude: ClaudeStatus) {
  const rust = { claude, checks: 0 };

  mockIPC((command) => {
    if (command !== "agent_claude_status") {
      throw new Error(`нет команды ${command}`);
    }

    rust.checks += 1;
    return rust.claude;
  });

  return rust;
}

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentSettings />
    </QueryClientProvider>,
  );
}

function radio(name: string) {
  return screen.getByRole<HTMLInputElement>("radio", { name });
}

afterEach(() => {
  cleanup();
  clearMocks();
  modelStore.setState(() => "claude-sonnet-5-5");
});

describe("раздел «Агент»", () => {
  it("Claude Code вошёл по подписке: видна версия", async () => {
    fakeRust(READY);
    open();

    expect(await screen.findByText("Вход по подписке Claude. Версия 2.1.316.")).toBeDefined();
  });

  it("без Claude Code раздел говорит, как его поставить", async () => {
    fakeRust({ state: "missing", version: null });
    open();

    expect(await screen.findByText(/Не найден. Поставьте его командой curl/)).toBeDefined();
  });

  it("вход не выполнен, а после входа «Проверить снова» видит подписку", async () => {
    const rust = fakeRust({ state: "logged_out", version: "2.1.316" });
    open();
    expect(await screen.findByText(/Вход не выполнен/)).toBeDefined();

    rust.claude = READY;
    fireEvent.click(screen.getByRole("button", { name: "Проверить снова" }));

    expect(await screen.findByText("Вход по подписке Claude. Версия 2.1.316.")).toBeDefined();
    expect(rust.checks).toBe(2);
  });

  it("выбранная модель остаётся выбранной, когда раздел открывают снова", async () => {
    fakeRust(READY);
    const view = open();
    await screen.findByText(/Вход по подписке/);
    expect(radio("Sonnet 5.5").checked).toBe(true);

    fireEvent.click(radio("Opus 5.5"));
    view.unmount();
    open();

    expect(radio("Opus 5.5").checked).toBe(true);
    expect(radio("Sonnet 5.5").checked).toBe(false);
  });
});
