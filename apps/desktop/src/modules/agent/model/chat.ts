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

export type ChatEntry = { kind: "user"; text: string } | { kind: "assistant"; text: string } | ToolEntry | ChangedEntry;

// Сообщения человека с этими номерами, по порядку. Номер это место
// сообщения среди всех сообщений человека, как turn в domain.rs.
export function questionsOf(entries: ChatEntry[], turns: number[]): { turn: number; text: string }[] {
  return entries
    .filter((entry) => entry.kind === "user")
    .map((entry, turn) => ({ turn, text: entry.text }))
    .filter((question) => turns.includes(question.turn));
}

// Событие, пока идёт ответ: кусок текста или отработавший инструмент.
export type ChatEvent = { kind: "text"; text: string } | ToolEntry;

// Что человек видит сейчас. Это уходит агенту вместе с сообщением.
export type ChatContext = { path: string | null; selection: string };

// Кусок текста дописывается к ответу, который идёт, инструмент встаёт
// своей строкой.
export function applyEvent(entries: ChatEntry[], event: ChatEvent): ChatEntry[] {
  const last = entries.at(-1);

  if (event.kind === "tool") {
    return [...entries, event];
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
] as const;

export type ToolName = (typeof TOOLS)[number];

export function isToolName(name: string): name is ToolName {
  return TOOLS.some((tool) => tool === name);
}

// Коды отказов из domain.rs, use_case.rs и chat_file.rs, у каждого своя
// подсказка. Чужой код окно показывает общей.
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
  "note_closed",
  "chat_unreadable",
  "chat_unwritable",
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
