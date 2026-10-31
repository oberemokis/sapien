import type { LockSettings } from "../model/lock";

const STORAGE_KEY = "sapien.lock";

// Блокировка это настройка устройства, как тема. Хранилище окна бывает
// закрыто политикой: тогда блокировка выключена, а приложение не падает.
export function readLockSettings(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLockSettings(settings: LockSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Выбор работает до закрытия окна, только не переживёт перезапуск.
  }
}

// Чем человек показывает, что он у окна. Колесо и движение мыши тоже:
// читать длинную заметку можно и без кликов.
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

export function subscribeActivity(onActivity: (event: Event) => void) {
  for (const event of ACTIVITY) {
    window.addEventListener(event, onActivity, { capture: true, passive: true });
  }

  return () => {
    for (const event of ACTIVITY) {
      window.removeEventListener(event, onActivity, { capture: true });
    }
  };
}

// Таймеры свёрнутого окна система замедляет, поэтому время проверяется
// и в момент, когда окно возвращается.
export function subscribeReturn(onReturn: () => void) {
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);

  return () => {
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}

// Пока окно закрыто, сочетания клавиш не доходят до страницы: иначе ⌘K
// открыл бы поиск поверх заглушки. Перехват на window в фазе захвата
// срабатывает раньше всех. Действие по умолчанию остаётся, поэтому Tab
// и Enter на кнопке заглушки работают.
function stop(event: KeyboardEvent) {
  event.stopPropagation();
}

export function blockShortcuts() {
  window.addEventListener("keydown", stop, { capture: true });

  return () => window.removeEventListener("keydown", stop, { capture: true });
}
