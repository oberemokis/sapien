import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library убирает за собой сама только при глобалах vitest, а они
// выключены: без этого разметка одного теста доживает до следующего.
afterEach(cleanup);

// Выборы окна живут в localStorage и не переходят из теста в тест.
afterEach(() => localStorage.clear());

// Шрифтов happy-dom не грузит: считается, что они уже есть.
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: { check: () => true, load: () => Promise.resolve([]) },
});
