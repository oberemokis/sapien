import { frontmatterList, frontmatterValue, splitFrontmatter } from "@/core/markdown/frontmatter";
import { hasModKey, isMac } from "@/core/ui/keys";

// Действие это заметка в папке «Действия» корня хранилища, как шаблон:
// имя файла это название, текст под шапкой это задание агенту, в шапке
// нужные ему интеграции и горячая клавиша. Вложенные папки не в счёт.
export const ACTIONS_FOLDER = "Действия";

export const INTEGRATIONS = ["youtrack"] as const;

export type Integration = (typeof INTEGRATIONS)[number];

export type ActionProblem = "emptyTask" | "unknownIntegration" | "badHotkey" | "reservedHotkey" | "takenHotkey";

export type Action = {
  path: string;
  name: string;
  task: string;
  integrations: Integration[];
  // Сочетание, на которое действие запускается, «Mod+Shift+Y». Кривое,
  // занятое приложением или другим действием сочетание здесь null,
  // а причина в problems.
  hotkey: string | null;
  // Как сочетание записано в шапке: его видно в настройках, даже кривое.
  hotkeyText: string;
  problems: ActionProblem[];
};

type Note = { path: string; text: string };

// Клавиша сочетания: буква, цифра или F1–F12. Остальные на разных
// раскладках и системах называются по-разному.
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/;

const MODIFIERS = ["Mod", "Alt", "Shift"] as const;

// Сочетания приложения и правки текста: действие их не перехватывает.
const RESERVED = new Set([
  "Mod+A",
  "Mod+B",
  "Mod+Shift+B",
  "Mod+C",
  "Mod+F",
  "Mod+H",
  "Mod+K",
  "Mod+M",
  "Mod+N",
  "Mod+Q",
  "Mod+V",
  "Mod+W",
  "Mod+X",
  "Mod+Y",
  "Mod+Z",
  "Mod+Shift+Z",
]);

// Сочетание из шапки в общем виде: «mod+shift+y» даёт «Mod+Shift+Y».
// Без Mod (⌘ на macOS, Ctrl на остальных) сочетание мешало бы набору.
export function parseHotkey(raw: string) {
  const parts = raw.split("+").map((part) => part.trim());
  const key = (parts.pop() ?? "").toUpperCase();
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  const known = MODIFIERS.filter((modifier) => modifiers.has(modifier.toLowerCase()));

  if (!KEY.test(key) || !modifiers.has("mod") || known.length !== modifiers.size) {
    return null;
  }

  return [...known, key].join("+");
}

type Keys = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

// Нажатое сочетание в той же записи. Клавиша берётся по месту на
// клавиатуре: с Alt на macOS буква превращается в другой знак.
export function hotkeyOf(event: Keys) {
  const key = event.code.replace(/^(?:Key|Digit)/, "");

  if (!hasModKey(event) || !KEY.test(key)) {
    return null;
  }

  return ["Mod", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}

// Подпись сочетания: «⌥⇧⌘Y» на macOS, «Ctrl+Alt+Shift+Y» на остальных.
export function hotkeyLabel(hotkey: string) {
  const parts = hotkey.split("+");
  const key = parts.at(-1);
  const alt = parts.includes("Alt");
  const shift = parts.includes("Shift");

  if (isMac) {
    return [alt && "⌥", shift && "⇧", "⌘", key].filter(Boolean).join("");
  }

  return ["Ctrl", alt && "Alt", shift && "Shift", key].filter(Boolean).join("+");
}

function unquote(value: string) {
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

function isIntegration(name: string): name is Integration {
  return INTEGRATIONS.some((integration) => integration === name);
}

function parseAction({ path, text }: Note): Action {
  const { yaml, body } = splitFrontmatter(text);
  const names = frontmatterList(yaml, "integrations").map(({ raw }) => unquote(raw).toLowerCase());
  const hotkeyText = frontmatterValue(yaml, "hotkey") ?? "";
  const task = body.trim();
  const problems: ActionProblem[] = [];
  let hotkey = parseHotkey(hotkeyText);

  if (task === "") {
    problems.push("emptyTask");
  }

  if (!names.every(isIntegration)) {
    problems.push("unknownIntegration");
  }

  if (hotkeyText !== "" && hotkey === null) {
    problems.push("badHotkey");
  }

  if (hotkey !== null && RESERVED.has(hotkey)) {
    problems.push("reservedHotkey");
    hotkey = null;
  }

  return {
    path,
    name: path.slice(ACTIONS_FOLDER.length + 1).replace(/\.md$/, ""),
    task,
    integrations: names.filter(isIntegration),
    hotkey,
    hotkeyText,
    problems,
  };
}

// Действия из заметок папки по алфавиту. Одно сочетание у двух действий
// не срабатывает ни у одного: какое из них имели в виду, не угадать.
export function actionsOf(notes: Note[]): Action[] {
  const actions = notes.map(parseAction).toSorted((a, b) => a.name.localeCompare(b.name, "ru"));

  return actions.map((action) => {
    const taken = actions.some((other) => other !== action && other.hotkey === action.hotkey);

    if (action.hotkey === null || !taken) {
      return action;
    }

    return { ...action, hotkey: null, problems: [...action.problems, "takenHotkey"] };
  });
}

// Без задания агенту нечего делать.
export function isRunnable(action: Action) {
  return action.task !== "";
}

// Коды те же, что у check_name в domain.rs хранилища: окно подсказывает
// заранее, Rust отвечает теми же.
const NAME_PROBLEMS = ["name_empty", "name_forbidden", "name_hidden", "name_taken"] as const;

export type ActionNameProblem = (typeof NAME_PROBLEMS)[number];

export function nameProblem(name: string, actions: Action[]): ActionNameProblem | null {
  const trimmed = name.trim();

  if (trimmed === "") {
    return "name_empty";
  }

  if (/[/\\:*?"<>|\p{Cc}]/u.test(trimmed)) {
    return "name_forbidden";
  }

  if (trimmed.startsWith(".")) {
    return "name_hidden";
  }

  if (actions.some((action) => action.name.toLowerCase() === trimmed.toLowerCase())) {
    return "name_taken";
  }

  return null;
}

// Отказ Rust при создании файла: код имени или null для остального.
export function nameProblemOf(error: unknown): ActionNameProblem | null {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  return NAME_PROBLEMS.find((problem) => problem === code) ?? null;
}

export function hotkeyProblem(hotkey: string, actions: Action[]): "reservedHotkey" | "takenHotkey" | null {
  if (RESERVED.has(hotkey)) {
    return "reservedHotkey";
  }

  if (actions.some((action) => action.hotkey === hotkey)) {
    return "takenHotkey";
  }

  return null;
}

// Текст файла нового действия. Шапка с обоими ключами, даже пустыми:
// так их видно, когда действие правят в редакторе.
export function actionText(task: string, integrations: Integration[], hotkey: string | null) {
  return `---\nintegrations: [${integrations.join(", ")}]\nhotkey: ${hotkey ?? ""}\n---\n${task.trim()}\n`;
}
