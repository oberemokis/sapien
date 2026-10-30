import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useSettingsShortcut } from "@/modules/settings";

export const Route = createRootRoute({ component: Root });

function Root() {
  useSettingsShortcut();

  return <Outlet />;
}
