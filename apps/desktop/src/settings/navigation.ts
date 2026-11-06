import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { hasModKey } from "@sapien/ui";
import { useSettingsMenu } from "./menu";

// Из самих настроек не делает ничего: второй вход в истории увёл бы «Назад»
// снова в настройки.
export function useOpenSettings() {
  const router = useRouter();

  return useCallback(() => {
    if (router.matchRoute({ to: "/settings" }, { fuzzy: true }) === false) {
      void router.navigate({ to: "/settings" });
    }
  }, [router]);
}

// Назад туда, откуда пришли: вкладки и панели живут в сторах и остаются
// какими были. Окно, открытое сразу на настройках, уходит на главный экран.
export function useCloseSettings() {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  return useCallback(() => {
    if (canGoBack) {
      router.history.back();
    } else {
      void router.navigate({ to: "/" });
    }
  }, [router, canGoBack]);
}

// Настройки открываются с любого экрана, как принято на macOS: пунктом
// «Настройки…» в меню приложения и ⌘,. В окне Tauri сочетание забирает
// меню, а в браузере без меню его ловит страница.
export function useSettingsShortcut() {
  const open = useOpenSettings();

  useSettingsMenu(open);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.code !== "Comma" || event.shiftKey || event.altKey || !hasModKey(event)) {
        return;
      }

      event.preventDefault();
      open();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
}

// Escape уводит с настроек, если его не забрал кто-то раньше: поле ввода,
// меню или плавающая панель.
export function useCloseOnEscape() {
  const close = useCloseSettings();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        close();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
}
