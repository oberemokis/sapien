import { useSelector } from "@tanstack/react-store";
import { useSyncExternalStore } from "react";
import {
  hasWindowButtons,
  readLayout,
  subscribeWindowWidth,
  windowWidth,
  writeLayout,
} from "../infrastructure/layout.device";
import {
  fitLayout,
  parseLayout,
  resizePanel,
  type LayoutState,
} from "../model/layout";
import { layoutStore } from "../store/layout.store";

type Panel = keyof LayoutState;

export const windowButtonsVisible = hasWindowButtons();

export function restoreLayout() {
  layoutStore.setState(() => parseLayout(readLayout()));
}

export function useWindowWidth() {
  return useSyncExternalStore(subscribeWindowWidth, windowWidth);
}

// На экране без чата его место достаётся середине, а выбор пользователя
// остаётся как был: на экране с чатом он вернётся.
export function useFittedLayout(withChat: boolean) {
  const layout = useSelector(layoutStore);
  const chat = { ...layout.chat, open: layout.chat.open && withChat };

  return fitLayout({ ...layout, chat }, useWindowWidth());
}

// Переключает то, что видно, а не сохранённый выбор: панель, которую спрятало
// узкое окно, по кнопке просят показать, а не закрыть ещё раз.
export function togglePanel(panel: Panel) {
  layoutStore.setState((layout) => ({
    ...layout,
    [panel]: {
      ...layout[panel],
      open: !fitLayout(layout, windowWidth())[panel].visible,
    },
  }));
  writeLayout(layoutStore.get());
}

// Зовётся на каждом шаге перетаскивания, поэтому только меняет состояние.
// Записывает saveLayout, когда указатель отпустили.
export function resizeLayoutPanel(panel: Panel, width: number) {
  layoutStore.setState((layout) => resizePanel(layout, panel, width, windowWidth()));
}

export function saveLayout() {
  writeLayout(layoutStore.get());
}
