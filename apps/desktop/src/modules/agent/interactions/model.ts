import { useSelector } from "@tanstack/react-store";
import { readAgentModel, writeAgentModel } from "../infrastructure/agent.device";
import { parseAgentModel, type AgentModel } from "../model/chat";
import { modelStore } from "../store/model.store";

// Выбор модели читается при первом обращении к модулю: до него модель
// никому не нужна, а мигать на экране нечему.
modelStore.setState(() => parseAgentModel(readAgentModel()));

export function useAgentModel() {
  return useSelector(modelStore);
}

export function setAgentModel(model: AgentModel) {
  modelStore.setState(() => model);
  writeAgentModel(model);
}
