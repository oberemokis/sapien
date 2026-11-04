import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSettings } from "@/modules/agent";
import type { ClaudeStatus } from "./model/claude";
import type { Integration } from "./model/sessions";

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

// Claude Code и интеграции агентов на устройстве за командами Rust.
// Состояние можно сменить посреди теста: так человек входит в терминале,
// пока окно открыто.
function fakeRust(claude: ClaudeStatus, integrations: Integration[] = []) {
  const rust = { claude, integrations, toggled: [] as string[] };

  mockIPC((command, args) => {
    const agent = (args as { agent?: string } | undefined)?.agent;
    const set = (state: Integration["state"]) => {
      rust.toggled.push(`${command} ${agent}`);
      rust.integrations = rust.integrations.map((found) => (found.agent === agent ? { ...found, state } : found));
      return null;
    };

    switch (command) {
      case "agent_claude_status":
        return rust.claude;
      case "agent_integrations":
        return rust.integrations;
      case "agent_integration_install":
        return set("on");
      case "agent_integration_remove":
        return set("off");
      default:
        throw new Error(`нет команды ${command}`);
    }
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

// Строка интеграции агента name: заголовок, пояснение и кнопка.
async function integration(name: string) {
  const title = await screen.findByText(name, { selector: "p" });

  return within(title.parentElement?.parentElement as HTMLElement);
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

  it("вход не выполнен, а после входа «Проверить снова» видит подписку", async () => {
    const rust = fakeRust({ state: "logged_out", version: "2.1.316" });
    open();
    expect(await screen.findByText(/Вход не выполнен/)).toBeDefined();

    rust.claude = READY;
    fireEvent.click(screen.getByRole("button", { name: "Проверить снова" }));

    expect(await screen.findByText("Вход по подписке Claude. Версия 2.1.316.")).toBeDefined();
  });
});

describe("продолжение разговоров", () => {
  it("интеграция подключается и отключается кнопкой, а без агента её ставить некуда", async () => {
    const rust = fakeRust(READY, [
      { agent: "codex", state: "off" },
      { agent: "opencode", state: "missing" },
    ]);
    open();

    const codex = await integration("Codex");
    expect(codex.getByText("Не подключена.")).toBeDefined();
    fireEvent.click(codex.getByRole("button", { name: "Подключить" }));

    // Codex не запустит хук, пока ему не доверились.
    expect(await codex.findByText(/Подключена.*Codex спросит, доверять ли хуку/)).toBeDefined();
    fireEvent.click(codex.getByRole("button", { name: "Отключить" }));
    await waitFor(() => expect(codex.getByText("Не подключена.")).toBeDefined());
    expect(rust.toggled).toEqual(["agent_integration_install codex", "agent_integration_remove codex"]);

    const opencode = await integration("OpenCode");
    expect(opencode.getByText("Не найден на этом устройстве.")).toBeDefined();
    expect(opencode.queryByRole("button")).toBeNull();
  });
});
