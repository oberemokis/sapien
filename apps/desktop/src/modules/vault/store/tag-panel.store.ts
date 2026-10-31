import { createStore } from "@tanstack/react-store";
import type { TagPanel } from "../model/tags";

export const tagPanelStore = createStore<TagPanel>("open");
