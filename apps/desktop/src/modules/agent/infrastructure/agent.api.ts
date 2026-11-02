import { invoke } from "@tauri-apps/api/core";
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
