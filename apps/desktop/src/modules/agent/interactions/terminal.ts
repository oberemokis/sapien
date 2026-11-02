import { useSelector } from "@tanstack/react-store";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalClose, terminalOpen, terminalResize, terminalWrite } from "../infrastructure/agent.api";
import { terminalsStore, type TerminalNotice, type TerminalState } from "../store/sessions.store";

// Терминал сессии в окне. Живёт дольше вкладки на экране: при переходе
// на другую вкладку его разметка уходит со страницы, а вывод Claude Code
// продолжает в неё писаться.
type View = {
  // Сессия меняется, когда разговор переходит в другую, например после /clear.
  session: string;
  term: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  // Ввод и размер уходят по одному: команды Rust асинхронные и иначе
  // могли бы поменять нажатия местами.
  queue: Promise<unknown>;
};

const views = new Map<string, View>();

// Задания действий для сессий, чей терминал ещё не открыт.
const tasks = new Map<string, string>();

const FONT_SIZE = 13;
const FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const FALLBACK = "ui-monospace, Menlo, monospace";
const IDLE: TerminalState = { notice: null, generation: 0 };

function setState(session: string, change: (state: TerminalState) => TerminalState) {
  terminalsStore.setState((states) => ({ ...states, [session]: change(states[session] ?? IDLE) }));
}

function setNotice(session: string, notice: TerminalNotice | null) {
  setState(session, (state) => ({ ...state, notice }));
}

// Цвета терминала из токенов темы. Берутся один раз, при создании.
function theme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();

  return {
    background: token("--background-bg-base"),
    foreground: token("--text-text-base"),
    cursor: token("--text-text-base"),
    selectionBackground: token("--overlay-pressed"),
  };
}

function send(view: View, request: (session: string) => Promise<unknown>) {
  view.queue = view.queue.then(() => request(view.session)).catch(() => undefined);
}

function create(session: string) {
  // Шрифт приложения грузится при первом использовании, а xterm меряет
  // знак при открытии: до загрузки идёт системный, потом замер заново.
  const font = `${FONT_SIZE}px "IBM Plex Mono"`;
  const view: View = {
    session,
    term: new Terminal({ fontFamily: FALLBACK, fontSize: FONT_SIZE, theme: theme(), cursorBlink: true }),
    fit: new FitAddon(),
    element: document.createElement("div"),
    queue: Promise.resolve(),
  };

  view.element.className = "h-full";
  view.term.loadAddon(view.fit);
  views.set(session, view);

  if (document.fonts.check(font)) {
    view.term.options.fontFamily = FONT;
  } else {
    void document.fonts.load(font).then(() => {
      view.term.options.fontFamily = FONT;
      view.fit.fit();
    });
  }

  return view;
}

// Claude Code сессии: Rust подключает окно к идущему или запускает его
// с заданием действия, если оно ждёт.
function start(view: View) {
  const task = tasks.get(view.session) ?? null;

  tasks.delete(view.session);
  view.term.onData((data) => send(view, (session) => terminalWrite(session, data)));
  view.term.onResize(({ cols, rows }) => send(view, (session) => terminalResize(session, cols, rows)));
  // Закрытый терминал вывода и плашек не получает.
  const shown = () => views.get(view.session) === view;

  view.queue = terminalOpen(view.session, view.term.cols, view.term.rows, task, (bytes) => {
    if (shown()) {
      view.term.write(bytes);
    }
  }).then(
    (opened) => {
      let notice: TerminalNotice | null = null;

      if (opened === "lost") {
        notice = "lost";
      }

      if (shown()) {
        setNotice(view.session, notice);
      }
    },
    () => {
      if (!shown()) {
        return;
      }

      // Задание не пропадает: «Повторить» отправит его снова.
      if (task !== null) {
        tasks.set(view.session, task);
      }

      setNotice(view.session, "failed");
    },
  );
}

// Терминал сессии на странице внутри host. Возвращает, как его убрать
// со страницы: сам терминал и Claude Code остаются.
export function attachTerminal(session: string, host: HTMLElement) {
  const existing = views.get(session);
  const view = existing ?? create(session);
  const observer = new ResizeObserver(() => view.fit.fit());

  host.append(view.element);

  if (existing === undefined) {
    view.term.open(view.element);
    view.fit.fit();
    start(view);
  } else {
    view.fit.fit();
  }

  observer.observe(host);
  view.term.focus();

  return () => {
    observer.disconnect();
    view.element.remove();
  };
}

function dispose(session: string) {
  views.get(session)?.term.dispose();
  views.delete(session);
}

// Задание уйдёт первым сообщением, когда сессию откроют.
export function queueTask(session: string, task: string) {
  tasks.set(session, task);
}

// Вкладку закрыли: Claude Code доживает до конца ответа, терминал окна
// уходит сразу.
export function closeTerminal(session: string) {
  dispose(session);
  tasks.delete(session);
  terminalsStore.setState((states) => Object.fromEntries(Object.entries(states).filter(([id]) => id !== session)));
  void terminalClose(session).catch(() => undefined);
}

// Claude Code кончился или не запустился: терминал начинается заново
// и продолжает разговор.
export function restartTerminal(session: string) {
  dispose(session);
  setState(session, ({ generation }) => ({ notice: null, generation: generation + 1 }));
}

// Claude Code сессии кончился сам. Закрытой вкладке сказать об этом некому.
export function terminalExited(session: string) {
  if (views.has(session)) {
    setNotice(session, "exited");
  }
}

// Разговор терминала перешёл в сессию to.
export function moveTerminal(from: string, to: string) {
  const view = views.get(from);

  if (view === undefined) {
    return;
  }

  dispose(to);
  views.delete(from);
  views.set(to, view);
  view.session = to;
  // Поколение from остаётся: пока вкладка не перешла, её терминал не
  // должен открыться заново.
  terminalsStore.setState((states) => {
    const state = states[from] ?? IDLE;

    return { ...states, [from]: { ...state, notice: null }, [to]: state };
  });
}

export function useTerminalState(session: string) {
  return useSelector(terminalsStore, (states) => states[session] ?? IDLE);
}
