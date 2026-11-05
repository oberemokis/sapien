import { fileURLToPath } from "node:url";

// Настройка vitest, общая для пакетов: тесты лежат рядом с кодом в src,
// окно подделывает happy-dom, за каждым тестом убирает setup.ts. Пакет
// кладёт её в `test` своего vitest.config.ts и дописывает своё.
export const testConfig = {
  environment: "happy-dom",
  include: ["src/**/*.spec.{ts,tsx}"],
  setupFiles: [fileURLToPath(new URL("setup.ts", import.meta.url))],
};
