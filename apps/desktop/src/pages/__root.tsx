import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useSettingsShortcut } from "@/modules/settings";
import { UpdateOffer } from "@/modules/updates";
import { useVaultSync } from "@/modules/vault";

export const Route = createRootRoute({ component: Root });

// Обновление предлагается поверх любого экрана, и проверка по расписанию
// живёт, пока открыто окно.
function Root() {
  useSettingsShortcut();
  useVaultSync();

  return (
    <>
      <Outlet />
      <UpdateOffer />
    </>
  );
}
