import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSettings } from "@/modules/agent";
import { useProviders } from "./interactions/agents";
import type { Provider } from "./model/agents";
import type { ClaudeStatus } from "./model/chat";

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

const CLAUDE: Provider = { id: "claude", name: "Claude Code", models: [] };

// Claude Code на устройстве за командой Rust. Состояние и агентов можно
// сменить посреди теста: так человек входит в терминале, пока окно открыто.
function fakeRust(claude: ClaudeStatus, providers: Provider[] = []) {
  const rust = { claude, providers };

  mockIPC((command) => {
    if (command === "agent_providers") {
      return rust.providers;
    }

    if (command !== "agent_claude_status") {
      throw new Error(`нет команды ${command}`);
    }

    return rust.claude;
  });

  return rust;
}

// Агенты, которых видит поле ввода чата: оно читает тот же список.
function ChatAgents() {
  const providers = useProviders().data;
  let names = "";

  if (providers !== undefined) {
    names = providers.map((provider) => provider.name).join(", ") || "нет";
  }

  return <output aria-label="Агенты чата">{names}</output>;
}

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentSettings />
      <ChatAgents />
    </QueryClientProvider>,
  );
}

function chatAgents() {
  return screen.getByLabelText("Агенты чата").textContent;
}

afterEach(() => {
  cleanup();
  clearMocks();
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

  it("вход не выполнен, а после входа «Проверить снова» видит подписку, и агент появляется у поля ввода", async () => {
    const rust = fakeRust({ state: "logged_out", version: "2.1.316" });
    open();
    expect(await screen.findByText(/Вход не выполнен/)).toBeDefined();
    await waitFor(() => expect(chatAgents()).toBe("нет"));

    rust.claude = READY;
    rust.providers = [CLAUDE];
    fireEvent.click(screen.getByRole("button", { name: "Проверить снова" }));

    expect(await screen.findByText("Вход по подписке Claude. Версия 2.1.316.")).toBeDefined();
    await waitFor(() => expect(chatAgents()).toBe("Claude Code"));
  });
});
