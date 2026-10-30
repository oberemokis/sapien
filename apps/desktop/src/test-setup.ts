import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library убирает за собой сама только при глобалах vitest, а они
// выключены: без этого разметка одного теста доживает до следующего.
afterEach(cleanup);
