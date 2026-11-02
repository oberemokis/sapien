import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "@/core/i18n/i18n";
import { restoreTheme, restoreUiScale, useThemeSync } from "@/modules/appearance";
import { restoreLayout } from "@/modules/layout";
import { restoreLock } from "@/modules/security";
import { routeTree } from "@/route-tree.gen";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

// Тема, масштаб и раскладка до первой отрисовки, иначе окно мигнёт чужой
// темой, а панели прыгнут из пустых значений в сохранённые. Блокировка тоже:
// включённая закрывает окно с первого кадра.
export function restoreDevice() {
  restoreLock();
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
