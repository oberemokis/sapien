import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { createStore, useSelector } from "@tanstack/react-store";
import type { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    undos: [] as number[],
    undoFails: false,
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
      // Откат помечает ответ и тех, кто откатился с ним.
      case "agent_undo": {
        const { turn } = args as { turn: number };

        rust.undos.push(turn);

        if (rust.undoFails) {
          throw { kind: "unavailable", code: "vault_unwritable" };
        }

        const undone = new Set(
          rust.history.flatMap((entry) => (entry.kind === "changed" && entry.turn === turn ? [turn, ...entry.with] : [])),
        );

        rust.history = rust.history.map((entry) =>
          entry.kind === "changed" && undone.has(entry.turn) ? { ...entry, undone: true, with: [] } : entry,
        );
        return null;
      }
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

// Чат на странице. show открывает другую заметку, как сделал бы человек.
function open() {
  const shown = createStore(CONTEXT);

  function Page() {
    return <AgentChat context={useSelector(shown)} />;
  }

  const root = createRootRoute({ component: Page });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { show: (context: ChatContext) => act(() => shown.setState(() => context)) };
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
    const context = await screen.findByRole("list", { name: "Уйдёт агенту вместе с сообщением" });
    expect(within(context).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["план", "выделенное"]);

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

  it("заметку и выделение можно убрать до отправки, следующая заметка приходит целиком", async () => {
    const rust = fakeRust();
    const view = open();

    fireEvent.click(await screen.findByRole("button", { name: "Не отправлять: выделенное" }));
    await ask("Вопрос без выделения");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0]?.context).toEqual({ path: "Проекты/план.md", selection: "" });
    rust.finish([]);

    fireEvent.click(await screen.findByRole("button", { name: "Не отправлять: план" }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    await ask("Вопрос без заметки");
    await waitFor(() => expect(rust.sent).toHaveLength(2));
    expect(rust.sent[1]?.context).toEqual({ path: null, selection: "" });
    rust.finish([]);

    view.show({ path: "Идеи.md", selection: "" });
    expect(await screen.findByText("Идеи")).toBeDefined();
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

  it("«Откатить» под ответом откатывает его правки, строка говорит, что откачено", async () => {
    const rust = fakeRust();
    rust.history.push(
      { kind: "user", text: "Отметь релиз" },
      { kind: "tool", name: "edit_note", target: "Проекты/план.md", ok: true },
      { kind: "assistant", text: "Отметил." },
      { kind: "changed", turn: 0, paths: ["Проекты/план.md", "итоги.md"], undone: false, with: [] },
    );
    open();

    expect(await screen.findByText("Изменено заметок: 2")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Откатить" }));

    expect(await screen.findByText("Откачено заметок: 2")).toBeDefined();
    expect(rust.undos).toEqual([0]);
    expect(screen.queryByRole("button", { name: "Откатить" })).toBeNull();
  });

  it("откат раннего ответа сначала показывает поздние, которые откатятся с ним", async () => {
    const rust = fakeRust();
    rust.history.push(
      { kind: "user", text: "Запиши план" },
      { kind: "assistant", text: "Записал." },
      { kind: "changed", turn: 0, paths: ["план.md"], undone: false, with: [2] },
      { kind: "user", text: "Как дела?" },
      { kind: "assistant", text: "Хорошо." },
      { kind: "user", text: "Перепиши план" },
      { kind: "assistant", text: "Переписал." },
      { kind: "changed", turn: 2, paths: ["план.md"], undone: false, with: [] },
    );
    open();

    const [first] = await screen.findAllByRole("button", { name: "Откатить" });
    fireEvent.click(first);

    const later = screen.getByRole("list", { name: "Откатятся вместе с ним" });
    expect(within(later).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Перепиши план"]);
    expect(rust.undos).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Откатить все" }));

    await waitFor(() => expect(screen.getAllByText("Откачено заметок: 1")).toHaveLength(2));
    expect(rust.undos).toEqual([0]);
  });

  it("не прошедший откат виден, а кнопка остаётся для повтора", async () => {
    const rust = fakeRust();
    rust.undoFails = true;
    rust.history.push(
      { kind: "user", text: "Отметь релиз" },
      { kind: "changed", turn: 0, paths: ["план.md"], undone: false, with: [] },
    );
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Откатить" }));

    expect(await screen.findByText("Откат не прошёл, попробуйте ещё раз.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Откатить" })).toBeDefined();
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
