import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "@/core/i18n/i18n";
import { restoreTheme, useThemeSync } from "@/modules/appearance";
import { restoreLayout } from "@/modules/layout";
import { restoreSession } from "@/modules/vault";
import { restoreDefaultProject, restoreInbox } from "@/modules/youtrack";
import { routeTree } from "@/route-tree.gen";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

// Тема, раскладка и вкладки до первой отрисовки, иначе окно мигнёт чужой
// темой, а панели и вкладки прыгнут из пустых значений в сохранённые.
// Зовёт main.tsx, когда хранилище приложения уже прочитано: в нём лента.
export function restoreDevice() {
  restoreTheme();
  restoreLayout();
  restoreSession();
  restoreDefaultProject();
  restoreInbox();
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
