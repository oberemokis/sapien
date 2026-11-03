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

// Терминал панели pane сессии session: оболочка в папке сессии, вывод
// байтами в onData, начиная с прежнего экрана панели. Оболочка ещё
// не идёт, и с task в ней сразу запускается Claude Code с этим заданием.
export function terminalOpen(
  session: string,
  pane: string,
  cols: number,
  rows: number,
  task: string | null,
  onData: (bytes: Uint8Array) => void,
) {
  const channel = new Channel<ArrayBuffer>((data) => onData(new Uint8Array(data)));

  return invoke<null>("terminal_open", { session, pane, cols, rows, task, onData: channel });
}

// Действие по расписанию: Claude Code с заданием в оболочке первой панели
// без вкладки.
export function terminalRun(session: string, task: string) {
  return invoke<null>("terminal_run", { session, task });
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
