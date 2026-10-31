import { createStore } from "@tanstack/react-store";
import type { AgentMethod } from "../model/method";

// Способ, который выбрал человек. null значит, что не выбирал.
export const methodStore = createStore<AgentMethod | null>(null);
