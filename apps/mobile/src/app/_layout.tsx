import "../global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Uniwind } from "uniwind";

const queryClient = new QueryClient();

// Тёмная тема по умолчанию, как у окна. Uniwind иначе стартует в теме
// системы. Выбор темы появится вместе с настройками (#4).
Uniwind.setTheme("dark");

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
