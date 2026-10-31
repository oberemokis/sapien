import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
// Компоненты берут строки из словаря, как в приложении.
import "@/core/i18n/i18n";
import { resetAppStorage } from "@/core/storage/app-storage";

// Testing Library убирает за собой сама только при глобалах vitest, а они
// выключены: без этого разметка одного теста доживает до следующего.
afterEach(cleanup);

// Хранилище приложения живёт в памяти окна, как localStorage, и так же
// не переходит из теста в тест.
afterEach(resetAppStorage);
