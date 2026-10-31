import { createStore } from "@tanstack/react-store";
import type { EditorMode } from "../model/mode";

export const editorModeStore = createStore<EditorMode>("preview");
