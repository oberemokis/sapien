import { cleanup } from "@testing-library/react";
import { changeLanguage } from "i18next";
import { afterEach, vi } from "vitest";
// Компоненты берут строки из словаря, как в приложении.
import "@/core/i18n/i18n";
import { Terminal } from "./test-xterm";

// Тесты ищут элементы по русским подписям. Английский по умолчанию
// проверяет свой тест и возвращает русский за собой.
void changeLanguage("ru");

// Testing Library убирает за собой сама только при глобалах vitest, а они
// выключены: без этого разметка одного теста доживает до следующего.
afterEach(cleanup);

// Выборы окна живут в localStorage и не переходят из теста в тест.
afterEach(() => localStorage.clear());

// Терминал сессии в happy-dom не рисуется: вместо xterm.js его подделка.
vi.mock("@xterm/xterm", () => import("./test-xterm"));
vi.mock("@xterm/addon-fit", () => import("./test-xterm"));
afterEach(() => {
  Terminal.created.length = 0;
});

// Шрифтов happy-dom не грузит: считается, что они уже есть.
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: { check: () => true, load: () => Promise.resolve([]) },
});
