import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "@/app/i18n/i18n";
import { restoreLanguage, restoreTheme, restoreUiScale, useThemeSync } from "@sapien/appearance";
import { restoreLayout } from "@sapien/layout";
import { restoreLock } from "@sapien/security";
import { routeTree } from "@/route-tree.gen";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

// Язык, тема, масштаб и раскладка до первой отрисовки, иначе окно мигнёт
// чужим языком и темой, а панели прыгнут из пустых значений в сохранённые.
// Блокировка тоже: включённая закрывает окно с первого кадра.
export function restoreDevice() {
  restoreLock();
  restoreLanguage();
  restoreTheme();
  restoreUiScale();
  restoreLayout();
}

// Без регистрации Link и navigate не знают дерева и принимают любую строку.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  useThemeSync();

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
