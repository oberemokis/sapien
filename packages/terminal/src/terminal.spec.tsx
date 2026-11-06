import { events } from "@sapien/ipc";
import { fakeRust, type FakeRust } from "@sapien/ipc/fake";
import { Terminal } from "@sapien/testing/xterm";
import { clearMocks } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionPanes, useTerminalEvents } from "./index";

const MOD = { metaKey: true };

type Opened = { session: string; pane: string; cols: number; rows: number };

// Терминалы окна живут дольше теста, поэтому у каждого теста своя
// сессия: терминал прошлого теста не подменит терминал этого.
let round = 0;

function later(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rust для терминалов. Набор лежит в written в порядке, в котором его
// приняла оболочка.
function terminalRust() {
  round += 1;

  const rust = fakeRust();
  const written: { pane: string; data: string }[] = [];
  let received = 0;

  // Команды Rust асинхронные: первое нажатие обрабатывается дольше
  // второго и без очереди в окне пришло бы вторым.
  rust.handle("terminalWrite", () => async (pane, data) => {
    received += 1;
    await later(received === 1 ? 30 : 0);
    written.push({ pane, data });
    return null;
  });

  return Object.assign(rust, { written, session: `s${round}` });
}

function opened(rust: FakeRust): Opened[] {
  return rust.calls.terminalOpen.map(([session, pane, cols, rows]) => ({ session, pane, cols, rows }));
}

function closed(rust: FakeRust) {
  return rust.calls.terminalClose.map(([pane]) => pane);
}

// Оболочка панели напечатала text. Первая панель сессии зовётся как сессия.
function print(rust: FakeRust, pane: string, text: string) {
  act(() => rust.print(pane, text));
}

// Панели сессии, как их ставит вкладка, и события терминалов, как
// их слушает оболочка окна.
function Panes({ session }: { session: string }) {
  useTerminalEvents();

  return <SessionPanes session={session} />;
}

function open(session: string) {
  render(<Panes session={session} />);
}

// Терминал на экране, когда панель одна.
function terminal() {
  const shown = Terminal.created.find((candidate) => !candidate.disposed && candidate.element?.isConnected);

  if (shown === undefined) {
    throw new Error("терминала на экране нет");
  }

  return shown;
}

// Панель name, например «Панель 2».
function region(name: string) {
  return screen.getByRole("region", { name });
}

// Место терминала в панели name: на нём фокус и правая кнопка.
function paneHost(name: string) {
  return within(region(name)).getByTestId("terminal");
}

function paneTerminal(name: string) {
  const host = paneHost(name);
  const shown = Terminal.created.find((candidate) => !candidate.disposed && host.contains(candidate.element));

  if (shown === undefined) {
    throw new Error(`терминала в панели «${name}» нет`);
  }

  return shown;
}

function paneNames() {
  return screen.queryAllByRole("region", { name: /^Панель/ }).map((found) => found.getAttribute("aria-label"));
}

function shownText() {
  return screen.getByTestId("terminal").textContent;
}

// Пусть окно доделает начатое: ответы Rust, перерисовка.
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

// Окно уходит раньше подделки Rust: отписка от событий идёт через неё,
// когда подписка уже ответила.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearMocks();
});

describe("терминал панели", () => {
  it("панель запускает оболочку сессии размером терминала, вывод виден, набор уходит по порядку", async () => {
    const rust = terminalRust();
    open(rust.session);

    await waitFor(() => expect(opened(rust)).toEqual([{ session: rust.session, pane: rust.session, cols: 80, rows: 24 }]));

    print(rust, rust.session, "~/sapien $ ");
    expect(shownText()).toContain("~/sapien $");

    act(() => {
      terminal().type("п");
      terminal().type("\r");
    });
    await waitFor(() =>
      expect(rust.written).toEqual([
        { pane: rust.session, data: "п" },
        { pane: rust.session, data: "\r" },
      ]),
    );
  });

  it("на запросы программ в прежнем экране терминал не отвечает, а на живые отвечает", async () => {
    const rust = terminalRust();
    // Прежний экран: агент при запуске спросил вид терминала.
    rust.state.screens[rust.session] = "$ claude\x1b[c\r\n";
    open(rust.session);

    await waitFor(() => expect(opened(rust)).toHaveLength(1));
    print(rust, rust.session, "$ ");
    await settle();
    expect(shownText()).toContain("$ claude");
    expect(rust.written).toEqual([]);

    // Живая программа спрашивает и ответ получает.
    print(rust, rust.session, "\x1b[c");
    await waitFor(() => expect(rust.written).toEqual([{ pane: rust.session, data: "\x1b[?1;2c" }]));
  });

  it("оболочка кончилась: плашка говорит об этом, «Открыть новую» запускает новую", async () => {
    const rust = terminalRust();
    open(rust.session);

    await waitFor(() => expect(opened(rust)).toHaveLength(1));

    await act(() => events.terminalExited.emit({ session: rust.session, pane: rust.session }));
    fireEvent.click(await screen.findByRole("button", { name: "Открыть новую" }));

    await waitFor(() => expect(opened(rust)).toHaveLength(2));
    expect(screen.queryByText("Оболочка завершилась.")).toBeNull();
  });

  it("оболочка не запустилась: «Повторить» запускает её снова", async () => {
    const rust = terminalRust();
    rust.refuse("terminalOpen", { kind: "unavailable", code: "terminal_failed" }, 1);
    open(rust.session);

    fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));

    await waitFor(() => expect(opened(rust)).toHaveLength(2));
    expect(opened(rust)[1]?.pane).toBe(rust.session);
    await waitFor(() => expect(screen.queryByText("Оболочка не запустилась.")).toBeNull());
  });
});

describe("панели сессии", () => {
  it("⌘D делит панель вправо: у новой панели своя оболочка, набор уходит в панель, где фокус", async () => {
    const rust = terminalRust();
    open(rust.session);

    await waitFor(() => expect(opened(rust)).toHaveLength(1));
    print(rust, rust.session, "до деления");

    fireEvent.keyDown(window, { code: "KeyD", ...MOD });
    await waitFor(() => expect(opened(rust)).toHaveLength(2));
    const fresh = opened(rust)[1]?.pane;
    expect(opened(rust)[1]).toEqual({ session: rust.session, pane: fresh, cols: 80, rows: 24 });
    expect(fresh).not.toBe(rust.session);
    expect(paneNames()).toEqual(["Панель 1", "Панель 2"]);

    // Первая панель держит свой терминал: вывод до деления на месте.
    expect(paneTerminal("Панель 1").element?.textContent).toContain("до деления");
    expect(closed(rust)).toEqual([]);

    act(() => paneTerminal("Панель 2").type("2"));
    fireEvent.focusIn(paneHost("Панель 1"));
    act(() => paneTerminal("Панель 1").type("1"));
    // У каждой панели своя очередь ввода, порядок между панелями не задан.
    await waitFor(() => expect(rust.written).toHaveLength(2));
    expect(rust.written).toEqual(
      expect.arrayContaining([
        { pane: fresh, data: "2" },
        { pane: rust.session, data: "1" },
      ]),
    );
    expect(region("Панель 1").dataset.active).toBe("true");
    expect(region("Панель 2").dataset.active).toBeUndefined();
  });

  it("⇧⌘D делит панель вниз, граница между панелями двигается стрелками", async () => {
    const rust = terminalRust();
    open(rust.session);

    fireEvent.keyDown(window, { code: "KeyD", shiftKey: true, ...MOD });
    const border = await screen.findByRole("separator", { name: "Граница панелей" });
    expect(border.getAttribute("aria-orientation")).toBe("horizontal");

    fireEvent.keyDown(border, { key: "ArrowDown" });
    expect(border.getAttribute("aria-valuenow")).toBe("55");
  });

  it("меню панели закрывает её оболочку, а единственную панель закрыть нельзя", async () => {
    const rust = terminalRust();
    open(rust.session);

    await waitFor(() => expect(opened(rust)).toHaveLength(1));

    fireEvent.contextMenu(paneHost("Панель 1"));
    expect(screen.getByRole("menuitem", { name: /^Закрыть панель/ })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("menuitem", { name: "Разделить вверх" }));
    await waitFor(() => expect(opened(rust)).toHaveLength(2));
    const fresh = opened(rust)[1]?.pane;
    // Новая панель встала сверху.
    expect(paneTerminal("Панель 1")).toBe(Terminal.created.at(-1));

    fireEvent.contextMenu(paneHost("Панель 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Закрыть панель/ }));

    await waitFor(() => expect(closed(rust)).toEqual([fresh]));
    expect(paneNames()).toEqual(["Панель 1"]);
    print(rust, rust.session, "осталась");
    expect(shownText()).toContain("осталась");
  });
});
