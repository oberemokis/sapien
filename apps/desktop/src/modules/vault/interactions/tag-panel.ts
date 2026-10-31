import { useSelector } from "@tanstack/react-store";
import { readTagPanel, writeTagPanel } from "../infrastructure/tag-panel.device";
import { parseTagPanel, type TagPanel } from "../model/tags";
import { tagPanelStore } from "../store/tag-panel.store";

export function restoreTagPanel() {
  tagPanelStore.setState(() => parseTagPanel(readTagPanel()));
}

export function useTagPanel() {
  return useSelector(tagPanelStore);
}

export function setTagPanel(panel: TagPanel) {
  tagPanelStore.setState(() => panel);
  writeTagPanel(panel);
}
