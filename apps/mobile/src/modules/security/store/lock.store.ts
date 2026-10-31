import { createStore } from "@tanstack/react-store";
import { DEFAULT_LOCK_SETTINGS, type LockSettings } from "../model/lock";

// away: приложение в фоне, и заглушка уже стоит, чтобы при возвращении
// содержимое не мелькнуло до проверки. locked: без проверки не снять.
export const lockStore = createStore<{ settings: LockSettings; locked: boolean; away: boolean }>({
  settings: DEFAULT_LOCK_SETTINGS,
  locked: false,
  away: false,
});
