// Ответ команд Rust из src-tauri/src/modules/youtrack. Токена в нём нет:
// окно отдаёт его в Rust один раз, при подключении.
export type YoutrackStatus =
  | { kind: "none" }
  | { kind: "connected"; host: string; name: string }
  // Подключение задано, но не работает. Код говорит почему.
  | { kind: "broken"; host: string; code: string };

// Итог публикации черновика, как Published в domain.rs.
export type Published =
  // Задача есть. failed это команды полей и связей, которые YouTrack не принял.
  | { kind: "done"; id: string; failed: string[] }
  // Обязательные поля проекта без значения: задача не создана.
  | { kind: "missing"; fields: string[] }
  // Название или описание поменяли в YouTrack: ничего не отправлено.
  | { kind: "diverged"; summary: string; description: string };

// Плашка опубликованной задачи.
export type IssueState = { id: string; state: string | null; assignee: string | null; url: string };

// Что проверка узнала у YouTrack, как Checked и IssueFacts в domain.rs.
// due это срок в миллисекундах.
export type IssueFacts = { id: string; found: boolean; resolved: boolean; sprint: string | null; due: number | null };

export type Checked = { projectFound: boolean; missing: string[]; issues: IssueFacts[] };

// Задача проекта, похожая на черновик.
export type Similar = { id: string; summary: string };

// Кого можно назначить исполнителем в проекте, как Person в domain.rs.
export type Person = { login: string; name: string };

// Коды отказов из domain.rs и use_case.rs, у каждого своя подсказка.
const PROBLEMS = [
  "youtrack_host_empty",
  "youtrack_host_invalid",
  "youtrack_host_insecure",
  "youtrack_token_empty",
  "youtrack_unreachable",
  "youtrack_not_youtrack",
  "youtrack_token_rejected",
  "youtrack_token_missing",
  "youtrack_not_connected",
  "youtrack_project_missing",
  "youtrack_issue_invalid",
  "youtrack_rejected",
  "youtrack_missing",
] as const;

export type YoutrackProblem = (typeof PROBLEMS)[number] | "failed";

function isProblem(code: unknown): code is YoutrackProblem {
  return PROBLEMS.some((problem) => problem === code);
}

// Код из статуса или из отказа команды, который приходит как AppError
// из error.rs: { kind, code }. Чужой код, например отказ хранилища паролей,
// окно показывает общей подсказкой.
export function youtrackProblemOf(errorOrCode: unknown): YoutrackProblem {
  let code = errorOrCode;

  if (typeof errorOrCode === "object" && errorOrCode !== null && "code" in errorOrCode) {
    code = errorOrCode.code;
  }

  if (isProblem(code)) {
    return code;
  }

  return "failed";
}
