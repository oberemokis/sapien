import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useEffect, useLayoutEffect } from "react";
import {
  blockShortcuts,
  readLockSettings,
  subscribeActivity,
  subscribeReturn,
  writeLockSettings,
} from "../infrastructure/lock.device";
import { appUnlock } from "../infrastructure/security.api";
import {
  idleFor,
  parseLockSettings,
  unlockFailureOf,
  type LockMinutes,
  type LockSettings,
  type UnlockFailure,
} from "../model/lock";
import { lockStore } from "../store/lock.store";

// Как часто сверяется время бездействия.
const CHECK_INTERVAL = 5_000;

// Зовётся до первой отрисовки. Включённая блокировка закрывает окно
// с запуска: иначе перезапуск открывал бы его без проверки.
export function restoreLock() {
  const settings = parseLockSettings(readLockSettings());

  lockStore.setState(() => ({ settings, locked: settings.enabled }));
}

export function useLockSettings() {
  return useSelector(lockStore, (state) => state.settings);
}

export function useLocked() {
  return useSelector(lockStore, (state) => state.locked);
}

function saveSettings(change: Partial<LockSettings>) {
  const settings = { ...lockStore.get().settings, ...change };

  lockStore.setState((state) => ({ ...state, settings }));
  writeLockSettings(settings);
}

function setLocked(locked: boolean) {
  lockStore.setState((state) => ({ ...state, locked }));
}

export function setLockMinutes(minutes: LockMinutes) {
  saveSettings({ minutes });
}

function failureOf(mutation: { isError: boolean; error: unknown }): UnlockFailure | null {
  if (!mutation.isError) {
    return null;
  }

  return unlockFailureOf(mutation.error);
}

// Включается блокировка только после удачной проверки: так видно, что
// системе есть чем спросить, и окно не закроется насовсем. Выключает её
// тот, кто и так сидит у открытого окна, без проверки.
export function useLockToggle() {
  const enable = useMutation({
    mutationFn: appUnlock,
    onSuccess: () => saveSettings({ enabled: true }),
  });

  function toggle(enabled: boolean) {
    if (enabled) {
      enable.mutate();
    } else {
      enable.reset();
      saveSettings({ enabled: false });
    }
  }

  return { toggle, checking: enable.isPending, failure: failureOf(enable) };
}

// Системе стало нечем спросить уже после включения (сняли пароль учётной
// записи, на Linux нет агента polkit): окно открывается без проверки,
// иначе оно закрылось бы насовсем. Кто сидит в открытой сессии системы,
// и так читает заметки с диска, блокировка закрывает окно только от
// случайного взгляда.
export function useUnlock() {
  const unlock = useMutation({
    mutationFn: appUnlock,
    onSuccess: () => setLocked(false),
    onError: (error) => {
      if (unlockFailureOf(error) === "unavailable") {
        setLocked(false);
      }
    },
  });

  return { unlock: () => unlock.mutate(), checking: unlock.isPending, failure: failureOf(unlock) };
}

// Пока стоит заглушка, сочетания клавиш до страницы не доходят.
export function useShortcutsBlocked() {
  useLayoutEffect(() => blockShortcuts(), []);
}

// Окно закрывается после бездействия. Пока оно закрыто, счёт стоит.
export function useIdleLock() {
  const { enabled, minutes } = useLockSettings();
  const locked = useLocked();

  useEffect(() => {
    if (!enabled || locked) {
      return;
    }

    let lastActivity = Date.now();

    function idle() {
      return idleFor(minutes, lastActivity, Date.now());
    }

    function check() {
      if (idle()) {
        setLocked(true);
      }
    }

    // Возвращение после долгого перерыва тоже действие, но оно не должно
    // дойти до страницы: щелчок или клавиша сначала закрывают окно.
    const stopActivity = subscribeActivity((event) => {
      if (idle()) {
        event.stopPropagation();
        setLocked(true);
      } else {
        lastActivity = Date.now();
      }
    });
    const stopReturn = subscribeReturn(check);
    const timer = setInterval(check, CHECK_INTERVAL);

    return () => {
      stopActivity();
      stopReturn();
      clearInterval(timer);
    };
  }, [enabled, locked, minutes]);
}
