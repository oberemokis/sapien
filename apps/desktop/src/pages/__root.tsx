import { Outlet, createRootRoute } from "@tanstack/react-router";
import { DataKeyNotice } from "@/modules/security";
import { useSettingsShortcut } from "@/modules/settings";
import { UpdateOffer } from "@/modules/updates";
import { useVaultSync } from "@/modules/vault";

export const Route = createRootRoute({ component: Root });

// Обновление и пропавший ключ данных предлагаются поверх любого экрана,
// а проверка обновлений по расписанию живёт, пока открыто окно.
function Root() {
  useSettingsShortcut();
  useVaultSync();

  return (
    <>
      <Outlet />
      <UpdateOffer />
      <DataKeyNotice />
    </>
  );
}
