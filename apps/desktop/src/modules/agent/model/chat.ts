// Модели на выбор, как MODELS в src-tauri/src/modules/agent/domain.rs.
// Первая по умолчанию.
export const AGENT_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;

export type AgentModel = (typeof AGENT_MODELS)[number];

export const MODEL_NAMES: Record<AgentModel, string> = {
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-opus-5-5": "Opus 5.5",
  "claude-haiku-5-5": "Haiku 5.5",
};

export function parseAgentModel(value: string | null): AgentModel {
  return AGENT_MODELS.find((model) => model === value) ?? AGENT_MODELS[0];
}

// Строки чата, как Entry в domain.rs. Инструмент назван, как его зовёт
// модель, цель это путь заметки, запрос или номер задачи.
export type ToolEntry = { kind: "tool"; name: string; target: string; ok: boolean };

// Ответ на сообщение человека с номером turn поменял заметки. with это
// более поздние ответы, которые откатятся вместе с ним.
export type ChangedEntry = { kind: "changed"; turn: number; paths: string[]; undone: boolean; with: number[] };

// Вопрос агента с вариантами. answer null: ответа ещё нет, не дождались
// или человека не было.
export type QuestionEntry = { kind: "question"; id: string; question: string; options: string[]; answer: string | null };

// Просьба разрешить правку заметки. Её видно, только пока она открыта.
export type PermissionEntry = { kind: "permission"; id: string; tool: string; path: string };

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | ToolEntry
  | QuestionEntry
  | PermissionEntry
  | ChangedEntry;

// Сообщения человека с этими номерами, по порядку. Номер это место
// сообщения среди всех сообщений человека, как turn в domain.rs.
export function questionsOf(entries: ChatEntry[], turns: number[]): { turn: number; text: string }[] {
  return entries
    .filter((entry) => entry.kind === "user")
    .map((entry, turn) => ({ turn, text: entry.text }))
    .filter((question) => turns.includes(question.turn));
}

// Вопрос человеку посреди ответа, как Question в domain.rs.
export type Question =
  | { kind: "choice"; id: string; question: string; options: string[] }
  | { kind: "permission"; id: string; tool: string; path: string };

// Ответ человека, как Answer в domain.rs.
export type Answer = { kind: "text"; text: string } | { kind: "allow" } | { kind: "deny" };

// Кто следит за ответом, как Oversight в domain.rs: человек разрешает
// правки, доверяет их агенту или его нет, как у действия по расписанию.
export type Oversight = "ask" | "trust" | "away";

// Событие, пока идёт ответ: кусок текста, отработавший инструмент,
// вопрос человеку и его закрытие.
export type ChatEvent =
  | { kind: "text"; text: string }
  | ToolEntry
  | { kind: "asked"; question: Question }
  | { kind: "answered"; id: string; answer: string | null };

// Что человек видит сейчас. Это уходит агенту вместе с сообщением.
export type ChatContext = { path: string | null; selection: string };

// Кусок текста дописывается к ответу, который идёт, инструмент и вопрос
// встают своей строкой. Закрытый вопрос получает ответ, а просьба
// о разрешении уходит: дальше видно саму правку. Вопрос, который окно
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

const TOOLS = [
  "list_notes",
  "search_notes",
  "read_note",
  "write_note",
  "edit_note",
  "youtrack_search",
  "youtrack_issue",
  "youtrack_epic_changes",
] as const;

export type ToolName = (typeof TOOLS)[number];

export function isToolName(name: string): name is ToolName {
  return TOOLS.some((tool) => tool === name);
}

// Коды отказов из domain.rs, use_case.rs, chat_file.rs и claude_code.rs,
// у каждого своя подсказка. Чужой код окно показывает общей.
const PROBLEMS = [
  "agent_key_missing",
  "agent_model_unknown",
  "agent_unreachable",
  "agent_key_rejected",
  "agent_billing",
  "agent_rate_limited",
  "agent_overloaded",
  "agent_too_large",
  "agent_model_unavailable",
  "agent_rejected",
  "agent_refused",
  "agent_too_long",
  "agent_too_many_steps",
  "agent_busy",
  "agent_bad_answer",
  "agent_question_closed",
  "note_closed",
  "chat_unreadable",
  "chat_unwritable",
  "claude_unsupported",
  "claude_missing",
  "claude_outdated",
  "claude_incompatible",
  "claude_logged_out",
  "claude_not_subscription",
  "claude_keychain_locked",
  "claude_limit",
  "claude_failed",
] as const;

// needsYoutrack ставит окно само: действию нужен YouTrack, а он не подключён.
export type ChatProblem = (typeof PROBLEMS)[number] | "failed" | "needsYoutrack";

// Отказ команды приходит как AppError из error.rs: { kind, code }.
export function chatProblemOf(error: unknown): ChatProblem {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  return PROBLEMS.find((problem) => problem === code) ?? "failed";
}
