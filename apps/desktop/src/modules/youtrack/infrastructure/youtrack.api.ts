import { invoke } from "@tauri-apps/api/core";
import type { DraftRequest } from "../model/draft";
import type {
  Checked,
  FeedEvent,
  IssueDetail,
  IssueState,
  Person,
  Published,
  Similar,
  TaskGraph,
  YoutrackStatus,
} from "../model/youtrack";

// Граф связей вокруг задач ids на depth связей, от одной до трёх.
export function youtrackGraph(ids: string[], depth: number) {
  return invoke<TaskGraph>("youtrack_graph", { ids, depth });
}

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

// Проект, обязательные поля и задачи из связей черновика глазами YouTrack.
export function youtrackCheck(draft: DraftRequest) {
  return invoke<Checked>("youtrack_check", { draft });
}

// Задачи проекта со словами названия черновика: кандидаты в дубли.
export function youtrackSimilar(project: string, summary: string) {
  return invoke<Similar[]>("youtrack_similar", { project, summary });
}

// Короткие имена проектов: с них начинаются номера задач.
export function youtrackProjects() {
  return invoke<string[]>("youtrack_projects");
}

// Последние задачи проекта, свежие первыми.
export function youtrackProjectIssues(project: string) {
  return invoke<Similar[]>("youtrack_project_issues", { project });
}

// Кого можно назначить исполнителем в проекте.
export function youtrackAssignees(project: string) {
  return invoke<Person[]>("youtrack_assignees", { project });
}

// События отслеживаемых задач с момента since: задачи по запросу и по
// номерам черновиков. Свои правки в ленту не попадают.
export function youtrackFeed(query: string, ids: string[], since: number) {
  return invoke<FeedEvent[]>("youtrack_feed", { query, ids, since });
}

// Задача с описанием и комментариями для карточки ленты.
export function youtrackIssueDetail(id: string) {
  return invoke<IssueDetail>("youtrack_issue_detail", { id });
}
