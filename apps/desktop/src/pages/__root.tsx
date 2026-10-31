import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useSettingsShortcut } from "@/modules/settings";
import { useVaultSync } from "@/modules/vault";

export const Route = createRootRoute({ component: Root });

function Root() {
  useSettingsShortcut();
  useVaultSync();

  return <Outlet />;
}
