import { Channel, invoke } from "@tauri-apps/api/core";
import type { Answer, ChatContext, ChatEntry, ChatEvent, Oversight } from "../model/chat";
import type { MeetingTask } from "../model/meeting";
import type { AgentMethod, ClaudeStatus } from "../model/method";

export function agentHistory() {
  return invoke<ChatEntry[]>("agent_history");
}

// Ответ идёт событиями через канал, а обещание кончается вместе с ответом.
// Ключ модели окно не шлёт: его берёт Rust.
export function agentSend(
  model: string,
  text: string,
  context: ChatContext,
  oversight: Oversight,
  onEvent: (event: ChatEvent) => void,
) {
  return invoke<null>("agent_send", { model, text, context, oversight, onEvent: new Channel<ChatEvent>(onEvent) });
}

// Окно открылось заново: события идущего ответа приходят сюда, открытый
// вопрос приходит снова. Кончается вместе с ответом, true, если он шёл.
export function agentAttach(onEvent: (event: ChatEvent) => void) {
  return invoke<boolean>("agent_attach", { onEvent: new Channel<ChatEvent>(onEvent) });
}

export function agentAnswer(id: string, answer: Answer) {
  return invoke<null>("agent_answer", { id, answer });
}

export function agentStop() {
  return invoke<null>("agent_stop");
}

export function agentClear() {
  return invoke<null>("agent_clear");
}

export function agentUndo(turn: number) {
  return invoke<null>("agent_undo", { turn });
}

// Rust сам читает заметку со встречи и спрашивает модель способом method.
// today нужен, чтобы посчитать срок «к пятнице».
export function agentMeetingTasks(method: AgentMethod, model: string, path: string, today: string) {
  return invoke<MeetingTask[]>("agent_meeting_tasks", { method, model, path, today });
}

// Есть ли Claude Code на устройстве, его версия и вход.
export function agentClaudeStatus() {
  return invoke<ClaudeStatus>("agent_claude_status");
}
