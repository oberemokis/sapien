import { Outlet, createRootRoute } from "@tanstack/react-router";
import { AppLock } from "@/modules/security";
import { useSettingsShortcut } from "@/modules/settings";
import { UpdateOffer } from "@/modules/updates";

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
