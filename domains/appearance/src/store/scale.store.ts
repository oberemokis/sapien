import { createStore } from "@tanstack/react-store";
import { DEFAULT_UI_SCALE, type UiScale } from "../model/scale";

export const uiScaleStore = createStore<UiScale>(DEFAULT_UI_SCALE);
