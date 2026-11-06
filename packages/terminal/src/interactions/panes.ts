import { useSelector } from "@tanstack/react-store";
import { panesSetting } from "../infrastructure/panes.device";
import {
  closePane as withoutPane,
  panesIn,
  resizeSplit,
  singlePane,
  splitPane as withPane,
  type Panes,
  type Side,
  type SplitPath,
} from "../model/panes";
import { panesStore } from "../store/terminal.store";
import { closeTerminal, focusTerminal } from "./terminal";

// Раскладки до первой отрисовки: вкладка сразу открывается с теми же
// панелями, что были.
export function restorePanes() {
  panesStore.setState(() => panesSetting.read());
}

function panesOf(session: string) {
  return panesStore.get()[session] ?? singlePane(session);
}

function setPanes(session: string, change: (panes: Panes) => Panes) {
  panesStore.setState((all) => ({ ...all, [session]: change(all[session] ?? singlePane(session)) }));
}

// Раскладка запоминается, когда её поменяли, а не на каждом шаге протяжки.
export function savePanes() {
  panesSetting.write(panesStore.get());
}

export function usePanes(session: string) {
  const stored = useSelector(panesStore, (all) => all[session]);

  return stored ?? singlePane(session);
}

// Все панели сессии слева направо и сверху вниз.
export function sessionPanes(session: string) {
  return panesIn(panesOf(session).layout);
}

// Новая панель со своей оболочкой встаёт со стороны side от панели pane,
// фокус переходит в неё.
export function splitPane(session: string, pane: string, side: Side) {
  setPanes(session, (panes) => withPane(panes, pane, side, crypto.randomUUID()));
  savePanes();
}

export function splitActivePane(session: string, side: Side) {
  splitPane(session, panesOf(session).active, side);
}

// Панель закрывается вместе со своим терминалом, место и фокус уходят
// соседке. Последнюю панель закрывает только вкладка.
export function closePane(session: string, pane: string) {
  const next = withoutPane(panesOf(session), pane);

  if (next === null) {
    return;
  }

  setPanes(session, () => next);
  savePanes();
  closeTerminal(pane);
  focusTerminal(next.active);
}

// Фокус пришёл в панель pane: она становится активной.
export function activatePane(session: string, pane: string) {
  if (panesOf(session).active !== pane) {
    setPanes(session, (panes) => ({ ...panes, active: pane }));
    savePanes();
  }
}

// Фокус в панель pane, если она ещё открыта: так строка агента в левой
// панели ведёт к его терминалу. Терминал вкладки, которой ещё нет
// на экране, получит фокус, когда появится.
export function focusPane(session: string, pane: string) {
  if (sessionPanes(session).includes(pane)) {
    activatePane(session, pane);
    focusTerminal(pane);
  }
}

export function resizePanes(session: string, path: SplitPath, ratio: number) {
  setPanes(session, (panes) => ({ ...panes, layout: resizeSplit(panes.layout, path, ratio) }));
}

// Удалённая сессия забывает и свои панели.
export function forgetPanes(session: string) {
  panesStore.setState((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== session)));
  savePanes();
}
