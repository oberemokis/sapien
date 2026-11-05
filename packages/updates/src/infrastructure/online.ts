import { useSyncExternalStore } from "react";

// Сеть пропала или вернулась.
function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);

  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function isOnline() {
  return navigator.onLine;
}

// Есть ли сеть. Без неё то, что ходит на сервер, недоступно заранее,
// а не падает ошибкой.
export function useOnline() {
  return useSyncExternalStore(subscribe, isOnline);
}
