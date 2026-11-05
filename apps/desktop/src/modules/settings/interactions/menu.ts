import { events } from "@sapien/ipc";
import { useEffect } from "react";

// «sapien → Настройки…» в меню macOS (src-tauri/src/menu.rs).
export function useSettingsMenu(open: () => void) {
  useEffect(() => {
    const listener = events.menuSettings.listen(() => open());

    return () => void listener.then((stop) => stop());
  }, [open]);
}
