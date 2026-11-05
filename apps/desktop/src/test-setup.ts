import { Terminal } from "@sapien/testing/xterm";
import { changeLanguage } from "i18next";
import { afterEach, vi } from "vitest";
// Компоненты берут строки из словаря, как в приложении.
import "@/core/i18n/i18n";

// Общую уборку за тестом делает @sapien/testing/setup, здесь то, что знает
// только окно.

// Тесты ищут элементы по русским подписям. Английский по умолчанию
// проверяет свой тест и возвращает русский за собой.
void changeLanguage("ru");

// Терминал сессии в happy-dom не рисуется: вместо xterm.js его подделка.
vi.mock("@xterm/xterm", () => import("@sapien/testing/xterm"));
vi.mock("@xterm/addon-fit", () => import("@sapien/testing/xterm"));
afterEach(() => {
  Terminal.created.length = 0;
});
