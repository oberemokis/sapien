import { Channel, invoke } from "@tauri-apps/api/core";
import type { Answer, ChatEntry, ChatEvent, ClaudeStatus, Oversight } from "../model/chat";
import type { Project, SessionInfo } from "../model/sessions";

export function projectsList() {
  return invoke<Project[]>("projects_list");
}

// Папку выбирает системный диалог в Rust. null: человек передумал.
export function projectsAdd() {
  return invoke<Project | null>("projects_add");
}

// Убирает проект из списка вместе с его сессиями. Папку на диске не трогает.
export function projectsRemove(id: string) {
  return invoke<null>("projects_remove", { id });
}

export function agentSessions() {
  return invoke<SessionInfo[]>("agent_sessions");
}

export function agentSessionNew(project: string) {
  return invoke<SessionInfo>("agent_session_new", { project });
}

export function agentSessionDelete(id: string) {
  return invoke<null>("agent_session_delete", { id });
}

export function agentHistory(session: string) {
  return invoke<ChatEntry[]>("agent_history", { session });
}

// Ответ идёт событиями через канал, а обещание кончается вместе с ответом.
// Ответ в приложении один на все сессии.
export function agentSend(
  session: string,
  model: string,
  text: string,
  oversight: Oversight,
  onEvent: (event: ChatEvent) => void,
) {
  return invoke<null>("agent_send", { session, model, text, oversight, onEvent: new Channel<ChatEvent>(onEvent) });
}

// Сессия, чей ответ идёт сейчас, или null.
export function agentRunning() {
  return invoke<string | null>("agent_running");
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

// Сессия Claude Code этого разговора: её продолжают в терминале. null,
// пока разговора не было.
export function agentClaudeSession(session: string) {
  return invoke<string | null>("agent_claude_session", { session });
}

// Есть ли Claude Code на устройстве, его версия и вход.
export function agentClaudeStatus() {
  return invoke<ClaudeStatus>("agent_claude_status");
}

// Действия лежат файлами в папке данных приложения, общие для всех
// проектов. path это имя файла, например «Сводка.md».
export function actionsList() {
  return invoke<{ path: string; text: string }[]>("actions_list");
}

export function actionsCreate(name: string, text: string) {
  return invoke<string>("actions_create", { name, text });
}

export function actionsWrite(path: string, text: string) {
  return invoke<null>("actions_write", { path, text });
}

export function actionsDelete(path: string) {
  return invoke<null>("actions_delete", { path });
}
