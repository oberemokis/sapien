import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "@/core/i18n/i18n";
import { restoreTheme, useThemeSync } from "@/modules/appearance";
import { restoreLayout } from "@/modules/layout";
import { restoreRecent } from "@/modules/vault";
import { routeTree } from "@/route-tree.gen";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

// Тема и раскладка до первой отрисовки, иначе окно мигнёт чужой темой
// и панели прыгнут из значений по умолчанию в сохранённые.
restoreTheme();
restoreLayout();
restoreRecent();

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
