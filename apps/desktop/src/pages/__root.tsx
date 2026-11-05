import { Outlet, createRootRoute } from "@tanstack/react-router";
import { AppLock } from "@sapien/security";
import { useSettingsShortcut } from "@/modules/settings";
import { UpdateOffer } from "@sapien/updates";

export const Route = createRootRoute({ component: Root });

// Обновление предлагается поверх любого экрана, а проверка обновлений
// по расписанию живёт, пока открыто окно. Блокировка закрывает всё это
// последней и ничего под собой не снимает.
function Root() {
  useSettingsShortcut();

  return (
    <>
      <Outlet />
      <UpdateOffer />
      <AppLock />
    </>
  );
}
