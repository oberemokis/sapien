import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentMeetingTasks } from "../infrastructure/agent.api";
import { chatProblemOf, type ChatProblem } from "../model/chat";
import { currentMethod } from "./method";
import { useAgentModel } from "./model";

// Сегодня по часам устройства. Шведская запись даты это ГГГГ-ММ-ДД.
function today() {
  return new Date().toLocaleDateString("sv-SE");
}

// «Задачи из встречи» по заметке. Ответ агента нужен, только пока его
// показывают, поэтому живёт в мутации, а не в кеше.
export function useMeetingTasks() {
  const model = useAgentModel();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (path: string) => agentMeetingTasks(await currentMethod(queryClient), model, path, today()),
  });
  let problem: ChatProblem | null = null;

  if (mutation.isError) {
    problem = chatProblemOf(mutation.error);
  }

  return { run: mutation.mutate, tasks: mutation.data ?? null, problem, reset: mutation.reset };
}
