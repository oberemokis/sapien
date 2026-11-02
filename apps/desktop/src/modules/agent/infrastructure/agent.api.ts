import { Channel, invoke } from "@tauri-apps/api/core";
import type { Choice, Commands, Provider } from "../model/agents";
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
// Ответы разных сессий идут параллельно, в одной сессии по одному.
export function agentSend(
  session: string,
  choice: Choice,
  text: string,
  oversight: Oversight,
  onEvent: (event: ChatEvent) => void,
) {
  return invoke<null>("agent_send", {
    session,
    provider: choice.provider,
    model: choice.model,
    effort: choice.effort,
    text,
    oversight,
    onEvent: new Channel<ChatEvent>(onEvent),
  });
}

// Агенты, установленные на устройстве, с их моделями. Rust спрашивает
// каждого агента, поэтому список читается редко.
export function agentProviders() {
  return invoke<Provider[]>("agent_providers");
}

// Команды, скилы и субагенты агента в папке проекта.
export function agentCommands(provider: string, project: string) {
  return invoke<Commands>("agent_commands", { provider, project });
}

// Сессии, чьи ответы идут сейчас.
export function agentRunning() {
  return invoke<string[]>("agent_running");
}

// Окно открылось заново: события идущего ответа сессии приходят сюда,
// открытый вопрос приходит снова. Кончается вместе с ответом, true, если
// он шёл.
export function agentAttach(session: string, onEvent: (event: ChatEvent) => void) {
  return invoke<boolean>("agent_attach", { session, onEvent: new Channel<ChatEvent>(onEvent) });
}

export function agentAnswer(session: string, id: string, answer: Answer) {
  return invoke<null>("agent_answer", { session, id, answer });
}

export function agentStop(session: string) {
  return invoke<null>("agent_stop", { session });
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
