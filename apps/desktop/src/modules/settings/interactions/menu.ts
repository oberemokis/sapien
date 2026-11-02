import { useEffect } from "react";
import { onSettingsMenu } from "../infrastructure/settings.api";

export function useSettingsMenu(open: () => void) {
  useEffect(() => {
    const listener = onSettingsMenu(open);

    return () => void listener.then((stop) => stop());
  }, [open]);
}
