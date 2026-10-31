import { useTranslation } from "react-i18next";
import { Pressable, Switch, Text, View } from "react-native";
import { setLockMinutes, useLockSettings, useLockToggle } from "../interactions/lock";
import { LOCK_MINUTES } from "../model/lock";

// Раздел «Безопасность»: блокировка приложения. Вид как у «Внешнего вида».
export function LockSettings() {
  const { t } = useTranslation();
  const settings = useLockSettings();
  const { toggle, checking, failure } = useLockToggle();
  let description: string = t("security.lock.description");

  if (checking) {
    description = t("security.lock.checking");
  } else if (failure === "failed") {
    description = t("security.lock.failed");
  } else if (failure === "unavailable") {
    description = t("security.lock.unavailable");
  }

  return (
    <View className="gap-3">
      <Text className="px-1 text-sm font-semibold text-content">{t("security.title")}</Text>
      <View className="gap-4 rounded-[10px] border border-stroke bg-card p-4">
        <View className="flex-row items-center gap-4">
          <View className="flex-1 gap-1">
            <Text className="text-base font-medium text-content">{t("security.lock.title")}</Text>
            <Text className="text-sm text-content-muted">{description}</Text>
          </View>
          <Switch
            accessibilityLabel={t("security.lock.title")}
            value={settings.enabled}
            disabled={checking}
            onValueChange={toggle}
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm text-content-muted">{t("security.lock.minutes")}</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t("security.lock.minutes")}
            className="flex-row rounded-lg border border-stroke p-0.5"
          >
            {LOCK_MINUTES.map((minutes) => {
              const checked = minutes === settings.minutes;

              return (
                <Pressable
                  key={minutes}
                  accessibilityRole="radio"
                  accessibilityState={{ checked }}
                  onPress={() => setLockMinutes(minutes)}
                  className={`flex-1 items-center rounded-md py-2 ${checked ? "bg-selection-strong" : ""}`}
                >
                  <Text className={`text-sm ${checked ? "text-content" : "text-content-muted"}`}>
                    {t(`security.lock.after.m${minutes}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}
