import { useSelector } from "@tanstack/react-store";
import { paintUiScale, readUiScale, writeUiScale } from "../infrastructure/scale.device";
import { parseUiScale, type UiScale } from "../model/scale";
import { uiScaleStore } from "../store/scale.store";

// Зовётся один раз до первой отрисовки, как тема: иначе окно сначала
// покажется в 100%, а потом сожмётся.
export function restoreUiScale() {
  const scale = parseUiScale(readUiScale());

  uiScaleStore.setState(() => scale);
  paintUiScale(scale);
}

export function useUiScale() {
  return useSelector(uiScaleStore);
}

export function setUiScale(scale: UiScale) {
  uiScaleStore.setState(() => scale);
  writeUiScale(scale);
  paintUiScale(scale);
}
