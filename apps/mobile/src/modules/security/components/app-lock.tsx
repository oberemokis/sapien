import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/core/ui/icon";
import { useAwayLock, useCovered, useLocked, useUnlock } from "../interactions/lock";

// Заглушка на весь экран. Пока приложение только в фоне, на ней нет
// кнопки: вернулись раньше срока, и она уходит сама.
function LockScreen() {
  const { t } = useTranslation();
  const locked = useLocked();
  const { unlock, checking, failure } = useUnlock();

  // Телефон открывают, чтобы им пользоваться, поэтому Face ID спрашивается
  // сразу. Отмена оставляет кнопку, сама проверка не повторяется.
  useEffect(() => {
    if (locked) {
      unlock();
    }
  }, [locked, unlock]);

  return (
    <View
      accessibilityViewIsModal
      style={StyleSheet.absoluteFill}
      className="items-center justify-center gap-4 bg-background-base"
    >
      <Icon icon={SquareLock02Icon} color="--color-content-muted" />
      <Text accessibilityRole="header" className="text-base font-semibold text-content">
        {t("security.lock.screen.title")}
      </Text>
      {locked && (
        <Pressable
          accessibilityRole="button"
          disabled={checking}
          onPress={unlock}
          className="rounded-lg border border-stroke px-4 py-2"
        >
          <Text className="text-sm text-content">{t("security.lock.screen.unlock")}</Text>
        </Pressable>
      )}
      {locked && failure === "failed" && (
        <Text accessibilityRole="alert" className="text-sm text-content-muted">
          {t("security.lock.screen.failed")}
        </Text>
      )}
    </View>
  );
}

// Приложение под заглушкой остаётся на месте, а для чтения с экрана
// скрыто: иначе VoiceOver прочёл бы его сквозь неё.
export function AppLock({ children }: { children: ReactNode }) {
  useAwayLock();
  const covered = useCovered();

  return (
    <>
      <View aria-hidden={covered} className="flex-1">
        {children}
      </View>
      {covered && <LockScreen />}
    </>
  );
}
