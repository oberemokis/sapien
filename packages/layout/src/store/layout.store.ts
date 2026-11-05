import { createStore } from "@tanstack/react-store";
import { INITIAL_LAYOUT, type LayoutState } from "../model/layout";

export const layoutStore = createStore<LayoutState>(INITIAL_LAYOUT);
