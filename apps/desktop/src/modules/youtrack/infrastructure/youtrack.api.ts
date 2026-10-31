import { invoke } from "@tauri-apps/api/core";
import type { DraftRequest } from "../model/draft";
import type { IssueState, Published, YoutrackStatus } from "../model/youtrack";

// Rust спрашивает сервер, кто владелец токена: ответ говорит, работает ли
// подключение прямо сейчас.
export function youtrackStatus() {
  return invoke<YoutrackStatus>("youtrack_status");
}

// Адрес и токен сохраняются, только если YouTrack по адресу принял токен.
export function youtrackConnect(host: string, token: string) {
  return invoke<YoutrackStatus>("youtrack_connect", { host, token });
}

// Стирает токен с устройства и забывает адрес.
export function youtrackDisconnect() {
  return invoke<null>("youtrack_disconnect");
}

// Публикует черновик заметки: без номера создаёт задачу, с номером
// обновляет. Текст заметки Rust кладёт в её историю версий.
export function youtrackPublish(path: string, text: string, draft: DraftRequest, id: string | null, force: boolean) {
  return invoke<Published>("youtrack_publish", { path, text, draft, id, force });
}

export function youtrackIssueState(id: string) {
  return invoke<IssueState>("youtrack_issue_state", { id });
}
