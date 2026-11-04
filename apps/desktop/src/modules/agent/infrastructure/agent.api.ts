import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeStatus } from "../model/claude";
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

// Имя от человека. Пустое отдаёт имя сессии агенту.
export function agentSessionRename(id: string, title: string) {
  return invoke<null>("agent_session_rename", { id, title });
}

// Терминал панели pane сессии session: оболочка в папке сессии, вывод
// байтами в onData, начиная с прежнего экрана панели.
export function terminalOpen(
  session: string,
  pane: string,
  cols: number,
  rows: number,
  onData: (bytes: Uint8Array) => void,
) {
  const channel = new Channel<ArrayBuffer>((data) => onData(new Uint8Array(data)));

  return invoke<null>("terminal_open", { session, pane, cols, rows, onData: channel });
}

export function terminalWrite(pane: string, data: string) {
  return invoke<null>("terminal_write", { pane, data });
}

export function terminalResize(pane: string, cols: number, rows: number) {
  return invoke<null>("terminal_resize", { pane, cols, rows });
}

// Панель закрыли, сама или с вкладкой: оболочка доживает до конца работы
// агента.
export function terminalClose(pane: string) {
  return invoke<null>("terminal_close", { pane });
}

// Сессии поменялись без команды окна: в терминале запустили агента или
// он вышел, начал или кончил работать, назвал сессию.
export function onSessionsChanged(handler: () => void) {
  return listen("agent-sessions", () => handler());
}

// Оболочка панели кончилась.
export function onTerminalExited(handler: (pane: string) => void) {
  return listen<{ session: string; pane: string }>("terminal-exited", ({ payload }) => handler(payload.pane));
}

// Есть ли Claude Code на устройстве, его версия и вход.
export function agentClaudeStatus() {
  return invoke<ClaudeStatus>("agent_claude_status");
}
