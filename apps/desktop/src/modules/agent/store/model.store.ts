import { createStore } from "@tanstack/react-store";
import { AGENT_MODELS, type AgentModel } from "../model/chat";

// Модель агента. Её выбирают в настройках, а зовёт чат.
export const modelStore = createStore<AgentModel>(AGENT_MODELS[0]);
