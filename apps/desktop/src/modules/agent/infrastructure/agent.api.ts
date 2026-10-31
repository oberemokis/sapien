import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatContext, ChatEntry, ChatEvent } from "../model/chat";
import type { MeetingTask } from "../model/meeting";

export function agentHistory() {
  return invoke<ChatEntry[]>("agent_history");
}

// Ответ идёт событиями через канал, а обещание кончается вместе с ответом.
// Ключ модели окно не шлёт: его берёт Rust.
export function agentSend(model: string, text: string, context: ChatContext, onEvent: (event: ChatEvent) => void) {
  return invoke<null>("agent_send", { model, text, context, onEvent: new Channel<ChatEvent>(onEvent) });
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

// Rust сам читает заметку со встречи и спрашивает модель. today нужен,
// чтобы посчитать срок «к пятнице».
export function agentMeetingTasks(model: string, path: string, today: string) {
  return invoke<MeetingTask[]>("agent_meeting_tasks", { model, path, today });
}
