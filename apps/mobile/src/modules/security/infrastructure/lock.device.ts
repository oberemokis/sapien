import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import Storage from "expo-sqlite/kv-store";
import { AppState, Platform, type AppStateStatus } from "react-native";
import type { LockSettings } from "../model/lock";

const STORAGE_KEY = "sapien.lock";

// Чтение синхронное, поэтому включённая блокировка закрывает приложение
// до первой отрисовки. Хранилище, которое не открылось, даёт выключенную.
export function readLockSettings(): string | null {
  try {
    return Storage.getItemSync(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLockSettings(settings: LockSettings) {
  try {
    Storage.setItemSync(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Выбор работает до закрытия приложения, только не переживёт перезапуск.
  }
}

// Face ID или отпечаток, а без них и после неудач код телефона.
// Отвечает кодом отказа или null, когда человек прошёл проверку.
export async function askOwner(promptMessage: string, cancelLabel: string): Promise<string | null> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel });

    if (result.success) {
      return null;
    }

    return result.error;
  } catch {
    return "unknown";
  }
}

// Снимок для переключателя приложений система делает сама, раньше, чем
// успела бы отрисоваться заглушка. iOS закрывает его размытием, Android
// флагом FLAG_SECURE: он же запрещает снимки экрана.
export async function protectSwitcher(on: boolean) {
  try {
    if (Platform.OS === "ios") {
      if (on) {
        await ScreenCapture.enableAppSwitcherProtectionAsync(1);
      } else {
        await ScreenCapture.disableAppSwitcherProtectionAsync();
      }
    } else if (on) {
      await ScreenCapture.preventScreenCaptureAsync();
    } else {
      await ScreenCapture.allowScreenCaptureAsync();
    }
  } catch {
    // Без защиты переключатель покажет последний экран, приложение работает.
  }
}

export function subscribeAppState(onChange: (state: AppStateStatus) => void) {
  const subscription = AppState.addEventListener("change", onChange);

  return () => subscription.remove();
}
