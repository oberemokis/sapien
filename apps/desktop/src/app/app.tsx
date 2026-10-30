import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { restoreTheme, useThemeSync } from "@/modules/appearance";
import { routeTree } from "@/route-tree.gen";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

// Тема до первой отрисовки, иначе окно мигнёт чужой темой.
restoreTheme();

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
