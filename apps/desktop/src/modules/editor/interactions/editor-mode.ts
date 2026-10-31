import { useSelector } from "@tanstack/react-store";
import { readEditorMode, writeEditorMode } from "../infrastructure/editor-mode.device";
import { parseEditorMode, type EditorMode } from "../model/mode";
import { editorModeStore } from "../store/editor-mode.store";

export function restoreEditorMode() {
  editorModeStore.setState(() => parseEditorMode(readEditorMode()));
}

export function useEditorMode() {
  return useSelector(editorModeStore);
}

export function setEditorMode(mode: EditorMode) {
  editorModeStore.setState(() => mode);
  writeEditorMode(mode);
}
