import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
// Компоненты берут строки из словаря, как в приложении.
import "@/core/i18n/i18n";

// Testing Library убирает за собой сама только при глобалах vitest, а они
// выключены: без этого разметка одного теста доживает до следующего.
afterEach(cleanup);

// Выборы окна живут в localStorage и не переходят из теста в тест.
afterEach(() => localStorage.clear());
