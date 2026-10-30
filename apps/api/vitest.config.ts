import { defineConfig } from "vitest/config";

// Псевдоним объявлен один раз, в поле imports пакета: его читают все резолверы
// сразу, потому что это правило самого пакета, а не настройка инструмента.
// Через paths в tsconfig так не выходит: desktop тянет тип приложения из api,
// и его исходники разбираются путями desktop, где @/ ведёт в другое место.
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
  },
});
