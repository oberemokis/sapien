import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { setThemePreference, useThemePreference } from "../interactions/theme";
import { THEME_PREFERENCES } from "../model/theme";

// Раздел «Внешний вид». Выбор применяется сразу, кнопки «Сохранить» нет.
// На узком экране управление стоит под описанием, а не справа от него.
export function AppearanceSettings() {
  const { t } = useTranslation();
  const preference = useThemePreference();

  return (
    <View className="gap-3">
      <Text className="px-1 text-sm font-semibold text-content">{t("appearance.title")}</Text>
      <View className="gap-3 rounded-[10px] border border-stroke bg-card p-4">
        <View className="gap-1">
          <Text className="text-base font-medium text-content">{t("appearance.theme.title")}</Text>
          <Text className="text-sm text-content-muted">{t("appearance.theme.description")}</Text>
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("appearance.theme.title")}
          className="flex-row rounded-lg border border-stroke p-0.5"
        >
          {THEME_PREFERENCES.map((value) => {
            const checked = value === preference;

            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                onPress={() => setThemePreference(value)}
                className={`flex-1 items-center rounded-md py-2 ${checked ? "bg-selection-strong" : ""}`}
              >
                <Text className={`text-sm ${checked ? "text-content" : "text-content-muted"}`}>
                  {t(`appearance.theme.${value}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
