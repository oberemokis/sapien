import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  askOwner,
  protectSwitcher,
  readLockSettings,
  subscribeAppState,
  writeLockSettings,
} from "../infrastructure/lock.device";
import { awayFor, parseLockSettings, unlockFailureOf, type LockMinutes, type LockSettings } from "../model/lock";
import { lockStore } from "../store/lock.store";

// Зовётся до первой отрисовки. Включённая блокировка закрывает приложение
// с запуска: иначе выгруженное системой открывалось бы без проверки.
export function restoreLock() {
  const settings = parseLockSettings(readLockSettings());

  lockStore.setState(() => ({ settings, locked: settings.enabled, away: false }));
}

export function useLockSettings() {
  return useSelector(lockStore, (state) => state.settings);
}

export function useLocked() {
  return useSelector(lockStore, (state) => state.locked);
}

export function useCovered() {
  return useSelector(lockStore, (state) => state.locked || state.away);
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

function useAskOwner() {
  const { t } = useTranslation();

  return async () => unlockFailureOf(await askOwner(t("security.lock.screen.prompt"), t("security.lock.screen.cancel")));
}

// Включается только после удачной проверки, как на окне: так видно, что
// телефону есть чем спросить. Выключает её тот, кто уже внутри.
export function useLockToggle() {
  const ask = useAskOwner();
  const enable = useMutation({
    mutationFn: ask,
    onSuccess: (failure) => {
      if (failure === null) {
        saveSettings({ enabled: true });
      }
    },
  });

  function toggle(enabled: boolean) {
    if (enabled) {
      enable.mutate();
    } else {
      enable.reset();
      saveSettings({ enabled: false });
    }
  }

  return { toggle, checking: enable.isPending, failure: enable.data ?? null };
}

// Код с телефона сняли уже после включения: приложение открывается без
// проверки, иначе оно закрылось бы насовсем. Без кода телефон и так
// открыт любому.
export function useUnlock() {
  const ask = useAskOwner();
  const { mutate, isPending, data } = useMutation({
    mutationFn: ask,
    onSuccess: (failure) => {
      if (failure === null || failure === "unavailable") {
        setLocked(false);
      }
    },
  });
  // Одна и та же между отрисовками: заглушка зовёт её из эффекта.
  const unlock = useCallback(() => mutate(), [mutate]);

  return { unlock, checking: isPending, failure: data ?? null };
}

// Приложение закрывается, если пробыло в фоне дольше заданного, и
// с включённой блокировкой не показывает себя в переключателе приложений.
// Окно проверки Face ID уводит приложение только в inactive, не в фон,
// поэтому само по себе блокировку не включает.
export function useAwayLock() {
  const { enabled, minutes } = useLockSettings();

  useEffect(() => {
    void protectSwitcher(enabled);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let hiddenAt: number | null = null;

    return subscribeAppState((state) => {
      if (state === "background") {
        hiddenAt = Date.now();
        lockStore.setState((current) => ({ ...current, away: true }));
      } else if (state === "active") {
        const due = hiddenAt !== null && awayFor(minutes, hiddenAt, Date.now());

        hiddenAt = null;
        lockStore.setState((current) => ({ ...current, locked: current.locked || due, away: false }));
      }
    });
  }, [enabled, minutes]);
}
