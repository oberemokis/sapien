import { startI18n } from "@sapien/i18n";
import { Terminal } from "@sapien/testing/xterm";
import { changeLanguage } from "i18next";
import { afterEach, vi } from "vitest";
import { dictionary } from "./dictionary";

// Тесты ищут элементы по русским подписям, как в окне с выбранным русским.
startI18n({ terminal: dictionary });
void changeLanguage("ru");

// В happy-dom xterm.js не рисует: вместо него подделка.
vi.mock("@xterm/xterm", () => import("@sapien/testing/xterm"));
vi.mock("@xterm/addon-fit", () => import("@sapien/testing/xterm"));
afterEach(() => {
  Terminal.created.length = 0;
});
