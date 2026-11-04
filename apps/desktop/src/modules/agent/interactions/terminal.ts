import { useSelector } from "@tanstack/react-store";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalClose, terminalOpen, terminalResize, terminalWrite } from "../infrastructure/agent.api";
import { terminalsStore, type TerminalNotice, type TerminalState } from "../store/sessions.store";

// Терминал панели в окне. Живёт дольше вкладки на экране: при переходе
// на другую вкладку его разметка уходит со страницы, а вывод оболочки
// продолжает в неё писаться.
type View = {
  session: string;
  pane: string;
  term: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  // Ввод и размер уходят по одному: команды Rust асинхронные и иначе
  // могли бы поменять нажатия местами.
  queue: Promise<unknown>;
};

// Терминалы по панелям.
const views = new Map<string, View>();

// Шрифт и размер терминала, как у opencode 2.0: значки шрифта рисуют
// приглашения оболочки. Шрифт лежит в приложении, см. styles.css.
const FONT_SIZE = 14;
const FAMILY = '"JetBrainsMono Nerd Font Mono"';
const FONT = `${FAMILY}, ui-monospace, Menlo, monospace`;
const FALLBACK = "ui-monospace, Menlo, monospace";
// Оба начертания: жирные клетки без своего файла рисовались бы системным.
const FACES = [`${FONT_SIZE}px ${FAMILY}`, `bold ${FONT_SIZE}px ${FAMILY}`];
const IDLE: TerminalState = { notice: null, generation: 0 };

function setState(pane: string, change: (state: TerminalState) => TerminalState) {
  terminalsStore.setState((states) => ({ ...states, [pane]: change(states[pane] ?? IDLE) }));
}

function setNotice(pane: string, notice: TerminalNotice | null) {
  setState(pane, (state) => ({ ...state, notice }));
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

function send(view: View, request: (pane: string) => Promise<unknown>) {
  view.queue = view.queue.then(() => request(view.pane)).catch(() => undefined);
}

function create(session: string, pane: string) {
  // Шрифт приложения грузится при первом использовании, а xterm меряет
  // знак при открытии: до загрузки идёт системный, потом замер заново.
  const view: View = {
    session,
    pane,
    term: new Terminal({ fontFamily: FALLBACK, fontSize: FONT_SIZE, theme: theme(), cursorBlink: true }),
    fit: new FitAddon(),
    element: document.createElement("div"),
    queue: Promise.resolve(),
  };

  view.element.className = "h-full";
  view.term.loadAddon(view.fit);
  views.set(pane, view);

  if (FACES.every((face) => document.fonts.check(face))) {
    view.term.options.fontFamily = FONT;
  } else {
    void Promise.all(FACES.map((face) => document.fonts.load(face))).then(() => {
      view.term.options.fontFamily = FONT;
      view.fit.fit();
    });
  }

  return view;
}

// Оболочка панели: Rust подключает окно к идущей или запускает её.
function start(view: View) {
  view.term.onData((data) => send(view, (pane) => terminalWrite(pane, data)));
  view.term.onResize(({ cols, rows }) => send(view, (pane) => terminalResize(pane, cols, rows)));
  // Закрытый терминал вывода и плашек не получает.
  const shown = () => views.get(view.pane) === view;

  view.queue = terminalOpen(view.session, view.pane, view.term.cols, view.term.rows, (bytes) => {
    if (shown()) {
      view.term.write(bytes);
    }
  }).then(
    () => {
      if (shown()) {
        setNotice(view.pane, null);
      }
    },
    () => {
      if (shown()) {
        setNotice(view.pane, "failed");
      }
    },
  );
}

// Терминал панели pane сессии session на странице внутри host. Возвращает,
// как его убрать со страницы: сам терминал и оболочка остаются.
export function attachTerminal(session: string, pane: string, host: HTMLElement) {
  const existing = views.get(pane);
  const view = existing ?? create(session, pane);
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

  return () => {
    observer.disconnect();
    view.element.remove();
  };
}

export function focusTerminal(pane: string) {
  views.get(pane)?.term.focus();
}

function dispose(pane: string) {
  views.get(pane)?.term.dispose();
  views.delete(pane);
}

// Панель закрыли, сама или с вкладкой: оболочка доживает до конца работы
// агента, терминал окна уходит сразу.
export function closeTerminal(pane: string) {
  dispose(pane);
  terminalsStore.setState((states) => Object.fromEntries(Object.entries(states).filter(([id]) => id !== pane)));
  void terminalClose(pane).catch(() => undefined);
}

// Оболочка кончилась или не запустилась: терминал начинается заново,
// с прежним экраном над новой оболочкой.
export function restartTerminal(pane: string) {
  dispose(pane);
  setState(pane, ({ generation }) => ({ notice: null, generation: generation + 1 }));
}

// Оболочка панели кончилась сама. Закрытой вкладке сказать об этом некому.
export function terminalExited(pane: string) {
  if (views.has(pane)) {
    setNotice(pane, "exited");
  }
}

export function useTerminalState(pane: string) {
  return useSelector(terminalsStore, (states) => states[pane] ?? IDLE);
}
