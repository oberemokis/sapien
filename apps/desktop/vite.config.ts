import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

// Tauri ждёт фронт по devUrl из src-tauri/tauri.conf.json. Занятый порт должен
// ронять запуск, а не уводить Vite на соседний, где окно его не найдёт.
const PORT = 1420;

export default defineConfig({
  // Иначе Vite стирает экран вместе с ошибками компиляции Rust из tauri dev.
  clearScreen: false,
  plugins: [
    // Генератор маршрутов идёт до react: он пишет дерево, которое react потом
    // компилирует.
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/pages",
      generatedRouteTree: "./src/route-tree.gen.ts",
      quoteStyle: "double",
      semicolons: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: PORT,
    strictPort: true,
    // Сборку Rust ведёт tauri dev, Vite в target/ смотреть незачем.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  preview: {
    port: PORT,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
