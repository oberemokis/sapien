// Claude Code на устройстве, как ClaudeStatus в domain.rs.
export type ClaudeState = "unsupported" | "missing" | "outdated" | "logged_out" | "not_subscription" | "ready";

export type ClaudeStatus = { state: ClaudeState; version: string | null };

// Строки чата, как Entry в domain.rs. Инструмент назван, как его зовёт
// Claude Code, цель это файл, команда, шаблон поиска или адрес.
export type ToolEntry = { kind: "tool"; name: string; target: string; ok: boolean };

// Вопрос агента с вариантами. answer null: ответа ещё нет, не дождались
// или человека не было.
export type QuestionEntry = { kind: "question"; id: string; question: string; options: string[]; answer: string | null };

// Просьба разрешить инструмент. Её видно, только пока она открыта.
export type PermissionEntry = { kind: "permission"; id: string; tool: string; target: string };

// Отметка в истории: ответ не вышел с кодом отказа (у лимита подписки
// resets, когда он сбросится, в секундах Unix) или Claude Code начал
// разговор заново (claude_session_new).
export type NoticeEntry = { kind: "notice"; code: string; resets: number | null };

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | ToolEntry
  | QuestionEntry
  | PermissionEntry
  | NoticeEntry;

// Вопрос человеку посреди ответа, как Question в domain.rs.
export type Question =
  | { kind: "choice"; id: string; question: string; options: string[] }
  | { kind: "permission"; id: string; tool: string; target: string };

// Ответ человека, как Answer в domain.rs.
export type Answer = { kind: "text"; text: string } | { kind: "allow" } | { kind: "deny" };

// Кто следит за ответом, как Oversight в domain.rs: человек разрешает
// инструменты, доверяет их агенту или его нет, как у действия по расписанию.
export type Oversight = "ask" | "trust" | "away";

// Событие, пока идёт ответ: кусок текста, отработавший инструмент,
// вопрос человеку и его закрытие.
export type ChatEvent =
  | { kind: "text"; text: string }
  | ToolEntry
  | { kind: "asked"; question: Question }
  | { kind: "answered"; id: string; answer: string | null };

// Кусок текста дописывается к ответу, который идёт, инструмент и вопрос
// встают своей строкой. Закрытый вопрос получает ответ, а просьба
// о разрешении уходит: дальше видно сам инструмент. Вопрос, который окно
// уже показывает, второй раз не встаёт.
export function applyEvent(entries: ChatEntry[], event: ChatEvent): ChatEntry[] {
  const last = entries.at(-1);

  if (event.kind === "tool") {
    return [...entries, event];
  }

  if (event.kind === "asked") {
    const question = event.question;

    if (entries.some((entry) => "id" in entry && entry.id === question.id)) {
      return entries;
    }

    if (question.kind === "permission") {
      return [...entries, question];
    }

    return [...entries, { kind: "question", id: question.id, question: question.question, options: question.options, answer: null }];
  }

  if (event.kind === "answered") {
    return entries
      .filter((entry) => entry.kind !== "permission" || entry.id !== event.id)
      .map((entry) => {
        if (entry.kind === "question" && entry.id === event.id) {
          return { ...entry, answer: event.answer };
        }

        return entry;
      });
  }

  if (last?.kind === "assistant") {
    return [...entries.slice(0, -1), { kind: "assistant", text: last.text + event.text }];
  }

  return [...entries, { kind: "assistant", text: event.text }];
}

// Встроенные инструменты Claude Code, у которых есть подпись. Чужой
// инструмент, например из MCP, виден своим именем.
const TOOLS = [
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
] as const;

export type ToolName = (typeof TOOLS)[number];

export function isToolName(name: string): name is ToolName {
  return TOOLS.some((tool) => tool === name);
}

// Коды отказов из domain.rs, use_case.rs и claude_code.rs, у каждого своя
// подсказка. Чужой код окно показывает общей.
const PROBLEMS = [
  "agent_provider_unknown",
  "agent_provider_locked",
  "agent_model_unknown",
  "agent_effort_unknown",
  "agent_unreachable",
  "agent_too_many_steps",
  "agent_busy",
  "agent_question_closed",
  "session_unreadable",
  "session_unwritable",
  "project_missing",
  "session_missing",
  "claude_unsupported",
  "claude_missing",
  "claude_incompatible",
  "claude_logged_out",
  "claude_not_subscription",
  "claude_keychain_locked",
  "claude_limit",
  "claude_tools_missing",
  "claude_failed",
] as const;

export type ChatProblem = (typeof PROBLEMS)[number] | "failed";

// Отказ команды приходит как AppError из error.rs: { kind, code }.
export function chatProblemOf(error: unknown): ChatProblem {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  return problemOf(code);
}

// Код отказа из отметки истории или ответа команды.
export function problemOf(code: unknown): ChatProblem {
  return PROBLEMS.find((problem) => problem === code) ?? "failed";
}

// Когда сбросится лимит подписки, по часам устройства.
export function resetsAt(resets: number): { date: string; time: string } {
  const at = new Date(resets * 1000);

  return {
    date: at.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
    time: at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  };
}

// Отказ уже стоит строкой в конце истории: второй раз внизу чата
// его показывать незачем.
export function isNoted(entries: ChatEntry[] | undefined, problem: ChatProblem) {
  const last = entries?.at(-1);

  return last?.kind === "notice" && problemOf(last.code) === problem;
}
