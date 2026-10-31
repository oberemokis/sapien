import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { createStore, useSelector } from "@tanstack/react-store";
import type { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChat } from "@/modules/agent";
import type { Answer, ChatContext, ChatEntry, ChatEvent, Question } from "./model/chat";
import type { ClaudeStatus } from "./model/method";
import { methodStore } from "./store/method.store";

type Sent = { method: string; model: string; text: string; context: ChatContext; oversight: string };

const READY: ClaudeStatus = { state: "ready", version: "2.1.316" };

// Сообщение в канал так, как его шлёт Rust. Каналы mockIPC держит здесь.
function toChannel(channel: Channel<ChatEvent>, index: number, message: ChatEvent) {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } })
    .__TAURI_INTERNALS__;

  internals.runCallback(channel.id, { index, message });
}

// Rust за командами агента: история чата, ключ и ответ, который идёт
// событиями через канал. Ответ кончается, когда тест его отпустит.
// ongoing это ответ, который уже идёт и ждёт ответа на вопрос, когда окно
// открывается: так выглядит перезагрузка окна. Claude Code по умолчанию
// не поддержан, и чат идёт ключом.
function fakeRust({
  key = true,
  ongoing = null,
  claude = { state: "unsupported", version: null },
}: { key?: boolean; ongoing?: Question | null; claude?: ClaudeStatus } = {}) {
  const rust = {
    history: [] as ChatEntry[],
    // Каким способом окно читало историю.
    read: [] as string[],
    session: null as string | null,
    sent: [] as Sent[],
    answers: [] as { id: string; answer: Answer }[],
    stops: 0,
    undos: [] as number[],
    undoFails: false,
    emit: (_event: ChatEvent) => {},
    finish: (_answer: ChatEntry[]) => {},
    fail: (_code: string) => {},
  };

  function listen(onEvent: Channel<ChatEvent>) {
    let index = 0;

    rust.emit = (event) => {
      toChannel(onEvent, index, event);
      index += 1;
    };
  }

  mockIPC((command, args) => {
    switch (command) {
      case "agent_attach": {
        if (ongoing === null) {
          return false;
        }

        listen((args as { onEvent: Channel<ChatEvent> }).onEvent);
        rust.emit({ kind: "asked", question: ongoing });

        return new Promise((resolve) => {
          rust.finish = (answer) => {
            rust.history.push(...answer);
            resolve(true);
          };
        });
      }
      case "agent_answer":
        rust.answers.push(args as { id: string; answer: Answer });
        return null;
      case "agent_clear":
        rust.history = [];
        return null;
      case "secret_status":
        return { ending: key ? "WXYZ" : null, kept: true };
      case "agent_history":
        rust.read.push((args as { method: string }).method);
        return rust.history;
      case "agent_claude_status":
        return claude;
      case "agent_claude_session":
        return rust.session;
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

        rust.sent.push(sent);
        listen(onEvent);

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
  localStorage.clear();
  methodStore.setState(() => null);
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
    expect(rust.sent[0]).toEqual({
      method: "key",
      model: "claude-sonnet-5-5",
      text: "Отметь релиз",
      context: CONTEXT,
      oversight: "ask",
    });

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

  it("без ключа ведёт в настройки, а отправить нельзя", async () => {
    const rust = fakeRust({ key: false });
    open();

    const link = await screen.findByRole("link", { name: "Задать ключ в настройках" });

    expect(link.getAttribute("href")).toBe("/settings/agent");
    await ask("Вопрос");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить" }).disabled).toBe(true);
    expect(rust.sent).toHaveLength(0);
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

function model() {
  return screen.getByRole("button", { name: /^Модель/ });
}

describe("способ агента", () => {
  it("с готовым Claude Code чат идёт подпиской, отказ встаёт строкой со временем сброса", async () => {
    const rust = fakeRust({ claude: READY });
    open();

    expect(await screen.findByText("Подписка Claude")).toBeDefined();
    await ask("Привет");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0].method).toBe("subscription");
    expect(rust.read).toContain("subscription");

    // 31 октября 2026, 15:00 по Москве.
    rust.history.push({ kind: "user", text: "Привет" }, { kind: "notice", code: "claude_limit", resets: 1_793_448_000 });
    rust.fail("claude_limit");

    const line = await screen.findByText(/Лимит подписки Claude исчерпан/);

    expect(line.textContent).toMatch(/Сбросится \d+ октября в \d\d:\d\d\./);
    // Строка уже в ленте: внизу чата отказ второй раз не встаёт.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(rust.sent).toHaveLength(2));
    expect(rust.sent[1]).toMatchObject({ method: "subscription", text: "" });
    rust.finish([{ kind: "assistant", text: "Привет!" }]);
    expect(await screen.findByText("Привет!")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });

  it("меню модели перечисляет модели обоих способов, другой способ меняет разговор после вопроса", async () => {
    const rust = fakeRust({ claude: READY });
    rust.history.push({ kind: "user", text: "Старый разговор" });
    open();

    await screen.findByText("Старый разговор");
    expect(model().getAttribute("aria-label")).toBe("Модель: Sonnet 5.5");
    fireEvent.click(model());

    const menu = screen.getByRole("menu");

    expect(within(menu).getByText("Подписка Claude")).toBeDefined();
    expect(within(menu).getByText("Ключ API")).toBeDefined();
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["Sonnet 5.5", "true"],
      ["Opus 5.5", "false"],
      ["Haiku 5.5", "false"],
      ["Sonnet 5.5", "false"],
      ["Opus 5.5", "false"],
      ["Haiku 5.5", "false"],
    ]);

    // Модель своего способа выбирается сразу.
    fireEvent.click(within(menu).getAllByRole("menuitemradio", { name: "Opus 5.5" })[0]);
    expect(model().getAttribute("aria-label")).toBe("Модель: Opus 5.5");
    expect(screen.queryByText(/Перейти к другому разговору/)).toBeNull();

    fireEvent.click(model());
    fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitemradio", { name: "Haiku 5.5" })[1]);

    expect(screen.getByText(/Перейти к другому разговору/)).toBeDefined();
    // Пока человек не ответил, модель и разговор прежние.
    expect(model().getAttribute("aria-label")).toBe("Модель: Opus 5.5");
    fireEvent.click(screen.getByRole("button", { name: "Перейти" }));

    expect(await screen.findByText("Ключ API")).toBeDefined();
    expect(model().getAttribute("aria-label")).toBe("Модель: Haiku 5.5");
    await waitFor(() => expect(rust.read).toContain("key"));
  });

  it("«Продолжить в терминале» копирует команду продолжения сессии", async () => {
    const rust = fakeRust({ claude: READY });
    const writeText = vi.fn(() => Promise.resolve());
    rust.session = "4f1c-9a";
    rust.history.push({ kind: "user", text: "Привет" });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Продолжить в терминале" }));

    expect(writeText).toHaveBeenCalledWith("claude --resume 4f1c-9a");
    expect(await screen.findByText("Скопировано, вставьте в терминал: claude --resume 4f1c-9a")).toBeDefined();
  });

  it("без входа в Claude Code ведёт в настройки, а модель ключа выбрать можно", async () => {
    const rust = fakeRust({ claude: { state: "logged_out", version: "2.1.316" } });
    methodStore.setState(() => "subscription");
    open();

    expect(await screen.findByText(/Вход не выполнен/)).toBeDefined();
    await ask("Вопрос");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Отправить" }).disabled).toBe(true);

    fireEvent.click(model());
    fireEvent.click(within(screen.getByRole("menu")).getAllByRole("menuitemradio", { name: "Sonnet 5.5" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0].method).toBe("key");
    rust.finish([]);
  });
});

const WHERE: Question = { kind: "choice", id: "q1", question: "Куда записать?", options: ["Идеи", "План"] };

// Доступ агента к правкам выбирают в меню под полем ввода.
function access() {
  return screen.getByRole("button", { name: /^Доступ к заметкам/ });
}

describe("вопросы и разрешения", () => {
  it("на вопрос агента уходит и выбранный вариант, и написанный ответ", async () => {
    const rust = fakeRust();
    open();
    await ask("Запиши мысль");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    rust.emit({ kind: "asked", question: WHERE });
    const question = await screen.findByRole("group", { name: "Вопрос агента" });

    expect(within(question).getByText("Куда записать?")).toBeDefined();
    expect(screen.queryByText("Агент думает…")).toBeNull();
    fireEvent.click(within(question).getByRole("button", { name: "Идеи" }));

    expect(rust.answers).toEqual([{ id: "q1", answer: { kind: "text", text: "Идеи" } }]);
    expect(within(question).queryByRole("button", { name: "План" })).toBeNull();
    expect(within(question).getByText("Идеи")).toBeDefined();

    rust.emit({ kind: "asked", question: { ...WHERE, id: "q2", question: "Как назвать?" } });
    await screen.findByText("Как назвать?");
    expect(field().placeholder).toBe("Свой ответ агенту, Enter отправит");
    await ask("Мысли на ноябрь");

    expect(rust.answers[1]).toEqual({ id: "q2", answer: { kind: "text", text: "Мысли на ноябрь" } });
    expect(rust.sent).toHaveLength(1);
    rust.finish([]);
    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
  });

  it("разрешение на правку: «Разрешить» и «Не разрешать» уходят агенту, просьба пропадает", async () => {
    const rust = fakeRust();
    open();
    await ask("Поправь план");
    await waitFor(() => expect(rust.sent).toHaveLength(1));

    rust.emit({ kind: "asked", question: { kind: "permission", id: "e1", tool: "edit_note", path: "Проекты/план.md" } });
    expect(await screen.findByText("Агент хочет изменить заметку Проекты/план.md.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Разрешить" }));

    rust.emit({ kind: "asked", question: { kind: "permission", id: "w1", tool: "write_note", path: "Идеи.md" } });
    expect(await screen.findByText("Агент хочет записать заметку Идеи.md целиком.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Не разрешать" }));

    expect(rust.answers).toEqual([
      { id: "e1", answer: { kind: "allow" } },
      { id: "w1", answer: { kind: "deny" } },
    ]);
    expect(screen.queryByRole("group", { name: "Разрешение на правку" })).toBeNull();
    rust.finish([]);
    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
  });

  it("полный доступ правит без вопросов до «Очистить», потом снова по разрешению", async () => {
    const rust = fakeRust();
    open();
    await screen.findByLabelText("Сообщение агенту");
    expect(access().getAttribute("aria-label")).toBe("Доступ к заметкам: По разрешению");
    fireEvent.click(access());

    const levels = screen.getAllByRole("menuitemradio").map((item) => [item.textContent, item.getAttribute("aria-checked")]);

    expect(levels).toEqual([
      ["По разрешениюспрашивает перед правкой", "true"],
      ["Полный доступправит без вопросов", "false"],
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Полный доступ/ }));
    expect(access().getAttribute("aria-label")).toBe("Доступ к заметкам: Полный доступ");

    await ask("Поправь план");
    await waitFor(() => expect(rust.sent).toHaveLength(1));
    expect(rust.sent[0].oversight).toBe("trust");
    rust.finish([{ kind: "user", text: "Поправь план" }]);

    fireEvent.click(await screen.findByRole("button", { name: "Очистить историю чата" }));
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));

    await waitFor(() => expect(access().getAttribute("aria-label")).toBe("Доступ к заметкам: По разрешению"));
    await ask("Ещё правка");
    await waitFor(() => expect(rust.sent).toHaveLength(2));
    expect(rust.sent[1].oversight).toBe("ask");
    rust.finish([]);
    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
  });

  it("окно открылось заново при открытом вопросе: вопрос на месте, ответ доходит", async () => {
    const rust = fakeRust({ ongoing: WHERE });
    open();

    const question = await screen.findByRole("group", { name: "Вопрос агента" });

    expect(screen.getByRole("button", { name: "Стоп" })).toBeDefined();
    fireEvent.click(within(question).getByRole("button", { name: "План" }));
    expect(rust.answers).toEqual([{ id: "q1", answer: { kind: "text", text: "План" } }]);

    rust.emit({ kind: "text", text: "Записал в план." });
    expect(await screen.findByText("Записал в план.")).toBeDefined();

    rust.finish([
      { kind: "user", text: "Запиши мысль" },
      { kind: "question", id: "q1", question: "Куда записать?", options: ["Идеи", "План"], answer: "План" },
      { kind: "assistant", text: "Записал в план." },
    ]);

    expect(await screen.findByRole("button", { name: "Отправить" })).toBeDefined();
    expect(screen.getByText("Запиши мысль")).toBeDefined();
    expect(screen.getAllByText("Записал в план.")).toHaveLength(1);
  });
});
