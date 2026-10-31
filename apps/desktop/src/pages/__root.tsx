import { Outlet, createRootRoute } from "@tanstack/react-router";
import { AppLock, DataKeyNotice } from "@/modules/security";
import { useSettingsShortcut } from "@/modules/settings";
import { UpdateOffer } from "@/modules/updates";
import { useVaultSync } from "@/modules/vault";

export const Route = createRootRoute({ component: Root });

// Обновление и пропавший ключ данных предлагаются поверх любого экрана,
// а проверка обновлений по расписанию живёт, пока открыто окно.
// Блокировка закрывает всё это последней и ничего под собой не снимает.
function Root() {
  useSettingsShortcut();
  useVaultSync();

  return (
    <>
      <Outlet />
      <UpdateOffer />
      <DataKeyNotice />
      <AppLock />
    </>
  );
}
