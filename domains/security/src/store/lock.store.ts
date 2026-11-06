import { createStore } from "@tanstack/react-store";
import { DEFAULT_LOCK_SETTINGS, type LockSettings } from "../model/lock";

export const lockStore = createStore<{ settings: LockSettings; locked: boolean }>({
  settings: DEFAULT_LOCK_SETTINGS,
  locked: false,
});
