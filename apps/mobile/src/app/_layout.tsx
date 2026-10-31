import "../global.css";
import "@/core/i18n/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { restoreTheme } from "@/modules/appearance";
import { AppLock, restoreLock } from "@/modules/security";

const queryClient = new QueryClient();

// Тема до первой отрисовки, иначе экран мигнёт чужой темой. Без сохранённого
// выбора тёмная, как у окна: Uniwind иначе стартует в теме системы.
// Блокировка тоже: включённая закрывает приложение с первого кадра.
restoreTheme();
restoreLock();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppLock>
        <Stack screenOptions={{ headerShown: false }} />
      </AppLock>
    </QueryClientProvider>
  );
}
