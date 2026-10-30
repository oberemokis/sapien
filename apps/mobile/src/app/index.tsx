import Note01Icon from "@hugeicons/core-free-icons/Note01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/core/ui/icon";

export default function Home() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background-base" style={{ paddingTop: insets.top }}>
      <View className="flex-row justify-end px-2">
        <Link href="/settings" asChild>
          <Pressable accessibilityLabel={t("settings.open")} hitSlop={8} className="size-11 items-center justify-center">
            <Icon icon={Settings01Icon} color="--color-content-muted" />
          </Pressable>
        </Link>
      </View>
      <View className="flex-1 items-center justify-center gap-2">
        <Icon icon={Note01Icon} color="--color-content-muted" />
        <Text className="text-sm text-content-muted">sapien</Text>
      </View>
    </View>
  );
}
