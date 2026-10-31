import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import type { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChat } from "@/modules/agent";
import type { ChatContext, ChatEntry, ChatEvent } from "./model/chat";

type Sent = { model: string; text: string; context: ChatContext };

// Сообщение в канал так, как его шлёт Rust. Каналы mockIPC держит здесь.
function toChannel(channel: Channel<ChatEvent>, index: number, message: ChatEvent) {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } })
    .__TAURI_INTERNALS__;

  internals.runCallback(channel.id, { index, message });
}

// Rust за командами агента: история чата, ключ и ответ, который идёт
// событиями через канал. Ответ кончается, когда тест его отпустит.
function fakeRust({ key = true } = {}) {
  const rust = {
    history: [] as ChatEntry[],
    sent: [] as Sent[],
    stops: 0,
    emit: (_event: ChatEvent) => {},
    finish: (_answer: ChatEntry[]) => {},
    fail: (_code: string) => {},
  };

  mockIPC((command, args) => {
    switch (command) {
      case "secret_status":
        return { ending: key ? "WXYZ" : null, kept: true };
      case "agent_history":
        return rust.history;
      case "agent_stop":
        rust.stops += 1;
        return null;
      case "agent_send": {
        const { onEvent, ...sent } = args as Sent & { onEvent: Channel<ChatEvent> };
        let index = 0;

        rust.sent.push(sent);
        rust.emit = (event) => {
          toChannel(onEvent, index, event);
          index += 1;
        };

        return new Promise((resolve, reject) => {
          rust.finish = (answer) => {
            rust.history.push(...answer);
            resolve(null);
          };
          rust.fail = (code) => reject({ kind: "invalid", code });
        });
      }
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return rust;
}

const CONTEXT: ChatContext = { path: "Проекты/план.md", selection: "пункт про релиз" };

function open() {
  const root = createRootRoute({ component: () => <AgentChat context={CONTEXT} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function field() {
  return screen.getByLabelText<HTMLTextAreaElement>("Сообщение агенту");
}

async function ask(text: string) {
  fireEvent.change(await screen.findByLabelText("Сообщение агенту"), { target: { value: text } });
  fireEvent.keyDown(field(), { key: "Enter" });
}

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
});

describe("чат с агентом", () => {
  it("сообщение уходит с тем, что открыто, ответ идёт потоком и остаётся в истории", async () => {
    const rust = fakeRust();
    open();
    expect(await screen.findByText("план, выделенное")).toBeDefined();

    await ask("Отметь релиз");

    expect(field().value).toBe("");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]).toEqual({ model: "claude-sonnet-5-5", text: "Отметь релиз", context: CONTEXT });

    const tool: ChatEntry = { kind: "tool", name: "edit_note", target: "Проекты/план.md", ok: true };
    rust.emit(tool);
    rust.emit({ kind: "text", text: "Отметил " });
    rust.emit({ kind: "text", text: "релиз." });

    expect(await screen.findByText("Отметил релиз.")).toBeDefined();
    expect(screen.getByText("Изменил")).toBeDefined();
    expect(screen.getByRole("button", { name: "Стоп" })).toBeDefined();

    rust.finish([{ kind: "user", text: "Отметь релиз" }, tool, { kind: "assistant", text: "Отметил релиз." }]);

    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(screen.getAllByText("Отметь релиз")).toHaveLength(1);
    expect(screen.getAllByText("Отметил релиз.")).toHaveLength(1);
  });

  it("«Стоп» останавливает ответ, пришедшее остаётся", async () => {
    const rust = fakeRust();
    open();
    await ask("Расскажи");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    rust.emit({ kind: "text", text: "Начало" });

    fireEvent.click(await screen.findByRole("button", { name: "Стоп" }));
    await waitFor(() => expect(rust.stops).toBe(1));
    rust.finish([{ kind: "user", text: "Расскажи" }, { kind: "assistant", text: "Начало" }]);

    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(screen.getByText("Начало")).toBeDefined();
  });

  it("отказ провайдера виден причиной, вопрос остаётся, «Повторить» шлёт его снова", async () => {
    const rust = fakeRust();
    open();
    await ask("Вопрос");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    rust.history.push({ kind: "user", text: "Вопрос" });
    rust.fail("agent_key_rejected");

    expect(await screen.findByText(/Anthropic не принял ключ/)).toBeDefined();
    expect(screen.getByText("Вопрос")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(rust.sent).toHaveLength(2));
    expect(rust.sent[1].text).toBe("");

    rust.finish([{ kind: "assistant", text: "Ответ" }]);
    expect(await screen.findByText("Ответ")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("без ключа вместо поля ввода ведёт в настройки", async () => {
    fakeRust({ key: false });
    open();

    const link = await screen.findByRole("link", { name: "Задать ключ в настройках" });

    expect(link.getAttribute("href")).toBe("/settings/agent");
    expect(screen.queryByLabelText("Сообщение агенту")).toBeNull();
  });

  it("без сети отправить нельзя, история читается", async () => {
    const rust = fakeRust();
    rust.history.push({ kind: "assistant", text: "Прошлый ответ" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    open();

    expect(await screen.findByText("Прошлый ответ")).toBeDefined();
    expect(screen.getByText(/Без сети агент недоступен/)).toBeDefined();

    await ask("Вопрос");

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить" }).disabled).toBe(true);
    expect(rust.sent).toHaveLength(0);
  });
});
