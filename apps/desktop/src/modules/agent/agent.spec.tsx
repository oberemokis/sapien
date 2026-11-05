import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRust } from "@sapien/ipc/fake";
import { clearMocks } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSettings } from "@/modules/agent";
import type { ClaudeStatus } from "@sapien/ipc";

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

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
    fakeRust({ state: { claude: READY } });
    open();

    expect(await screen.findByText("Вход по подписке Claude. Версия 2.1.316.")).toBeDefined();
  });

  it("без Claude Code раздел говорит, как его поставить", async () => {
    fakeRust({ state: { claude: { state: "missing", version: null } } });
    open();

    expect(await screen.findByText(/Не найден. Поставьте его командой curl/)).toBeDefined();
  });

  it("вход не выполнен, а после входа «Проверить снова» видит подписку", async () => {
    const rust = fakeRust({ state: { claude: { state: "logged_out", version: "2.1.316" } } });
    open();
    expect(await screen.findByText(/Вход не выполнен/)).toBeDefined();

    rust.state.claude = READY;
    fireEvent.click(screen.getByRole("button", { name: "Проверить снова" }));

    expect(await screen.findByText("Вход по подписке Claude. Версия 2.1.316.")).toBeDefined();
  });
});

describe("продолжение разговоров", () => {
  it("интеграция подключается и отключается кнопкой, а без агента её ставить некуда", async () => {
    const rust = fakeRust({
      state: {
        integrations: [
          { agent: "codex", state: "off" },
          { agent: "opencode", state: "missing" },
        ],
      },
    });
    open();

    const codex = await integration("Codex");
    expect(codex.getByText("Не подключена.")).toBeDefined();
    fireEvent.click(codex.getByRole("button", { name: "Подключить" }));

    // Codex не запустит хук, пока ему не доверились.
    expect(await codex.findByText(/Подключена.*Codex спросит, доверять ли хуку/)).toBeDefined();
    fireEvent.click(codex.getByRole("button", { name: "Отключить" }));
    await waitFor(() => expect(codex.getByText("Не подключена.")).toBeDefined());
    expect(rust.calls.agentIntegrationInstall).toEqual([["codex"]]);
    expect(rust.calls.agentIntegrationRemove).toEqual([["codex"]]);

    const opencode = await integration("OpenCode");
    expect(opencode.getByText("Не найден на этом устройстве.")).toBeDefined();
    expect(opencode.queryByRole("button")).toBeNull();
  });
});
