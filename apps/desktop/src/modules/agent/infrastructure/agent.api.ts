import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeStatus } from "../model/claude";
import type { Project, SessionInfo } from "../model/sessions";
import type { Usage } from "../model/usage";

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

// Как открылся терминал, как Opened в Rust: подключился к идущему Claude
// Code, начал разговор, продолжил прежний или начал заново, потому что
// Claude Code прежнего не помнит.
export type Opened = "attached" | "started" | "resumed" | "lost";

// Терминал сессии: Claude Code в её папке, вывод байтами в onData. task
// уходит первым сообщением, если Claude Code ещё не идёт.
export function terminalOpen(
  session: string,
  cols: number,
  rows: number,
  task: string | null,
  onData: (bytes: Uint8Array) => void,
) {
  const channel = new Channel<ArrayBuffer>((data) => onData(new Uint8Array(data)));

  return invoke<Opened>("terminal_open", { session, cols, rows, task, onData: channel });
}

// Действие по расписанию: Claude Code с заданием без вкладки.
export function terminalRun(session: string, task: string) {
  return invoke<null>("terminal_run", { session, task });
}

export function terminalWrite(session: string, data: string) {
  return invoke<null>("terminal_write", { session, data });
}

export function terminalResize(session: string, cols: number, rows: number) {
  return invoke<null>("terminal_resize", { session, cols, rows });
}

// Вкладку закрыли: Claude Code доживает до конца ответа.
export function terminalClose(session: string) {
  return invoke<null>("terminal_close", { session });
}

// Сессии поменялись без команды окна: агент начал или кончил отвечать,
// у сессии появилось название.
export function onSessionsChanged(handler: () => void) {
  return listen("agent-sessions", () => handler());
}

// Разговор терминала перешёл в другую сессию, например после /clear.
export function onTerminalMoved(handler: (from: string, to: string) => void) {
  return listen<{ from: string; to: string }>("terminal-moved", ({ payload }) => handler(payload.from, payload.to));
}

// Claude Code сессии кончился.
export function onTerminalExited(handler: (session: string) => void) {
  return listen<{ session: string }>("terminal-exited", ({ payload }) => handler(payload.session));
}

// Лимиты подписки Claude. Их спрашивает Claude Code своим входом.
export function agentUsage() {
  return invoke<Usage>("agent_usage");
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
