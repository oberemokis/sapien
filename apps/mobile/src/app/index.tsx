import Note01Icon from "@hugeicons/core-free-icons/Note01Icon";
import { Text, View } from "react-native";
import { Icon } from "@/core/ui/icon";

export default function Home() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-background-base">
      <Icon icon={Note01Icon} color="--color-content-muted" />
      <Text className="text-sm text-content-muted">sapien</Text>
    </View>
  );
}
