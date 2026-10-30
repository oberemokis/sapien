import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/core/ui/icon";
import { AppearanceSettings } from "@/modules/appearance";

// Настройки телефона. Разделов пока один, поэтому они идут одним списком
// на экране, а не отдельными экранами, как на окне.
export default function Settings() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Экран, открытый ссылкой извне, назад не ведёт никуда: тогда на главный.
  function back() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  return (
    <View className="flex-1 bg-background-base" style={{ paddingTop: insets.top }}>
      <View className="h-11 flex-row items-center px-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("settings.back")}
          hitSlop={8}
          onPress={back}
          className="size-11 items-center justify-center"
        >
          <Icon icon={ArrowLeft01Icon} />
        </Pressable>
        <Text accessibilityRole="header" className="text-base font-semibold text-content">
          {t("settings.title")}
        </Text>
      </View>
      <ScrollView contentContainerClassName="gap-8 p-4" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        <AppearanceSettings />
      </ScrollView>
    </View>
  );
}
