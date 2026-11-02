import { frontmatterValue, splitFrontmatter } from "@/core/markdown/frontmatter";
import { hasModKey, isMac } from "@/core/ui/keys";

// Действие это файл .md в папке действий приложения, общий для всех
// проектов: имя файла это название, текст под шапкой это задание агенту,
// в шапке горячая клавиша и расписание.
export type ActionProblem = "emptyTask" | "badHotkey" | "reservedHotkey" | "takenHotkey" | "badSchedule";

// Расписание: дни недели (0 воскресенье, пусто значит каждый день)
// и время в минутах от полуночи по часам устройства.
export type Schedule = { days: number[]; minutes: number };

export type Action = {
  path: string;
  name: string;
  // Задание агенту. {{since}} и {{today}} подставляются при запуске.
  task: string;
  // Сочетание, на которое действие запускается, «Mod+Shift+Y». Кривое,
  // занятое приложением или другим действием сочетание здесь null,
  // а причина в problems.
  hotkey: string | null;
  // Как сочетание записано в шапке: его видно в настройках, даже кривое.
  hotkeyText: string;
  // Когда действие запускается само. Кривое расписание здесь null.
  schedule: Schedule | null;
  scheduleText: string;
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

const DAYS = [
  ["sun", "вс"],
  ["mon", "пн"],
  ["tue", "вт"],
  ["wed", "ср"],
  ["thu", "чт"],
  ["fri", "пт"],
  ["sat", "сб"],
];

// Расписание из шапки: «Mon 10:00», «пн, чт 9:30» или «10:00» каждый день.
export function parseSchedule(raw: string): Schedule | null {
  const match = /^(.*?)\s*(\d{1,2}):(\d{2})$/.exec(raw.trim());
  const hours = Number(match?.[2]);
  const minutes = Number(match?.[3]);
  const names = (match?.[1] ?? "")
    .split(/[\s,]+/)
    .map((name) => name.toLowerCase())
    .filter((name) => name !== "");
  const days = names.map((name) => DAYS.findIndex((aliases) => aliases.includes(name)));

  if (match === null || hours > 23 || minutes > 59 || days.includes(-1)) {
    return null;
  }

  return { days: [...new Set(days)].toSorted(), minutes: hours * 60 + minutes };
}

// Последний срок по расписанию не позже now, за прошедшую неделю.
export function lastSlot({ days, minutes }: Schedule, now: Date) {
  for (let back = 0; back <= 7; back += 1) {
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 0, minutes);

    if (slot <= now && (days.length === 0 || days.includes(slot.getDay()))) {
      return slot;
    }
  }

  return null;
}

// Когда окно последний раз смотрело на действие по расписанию и был ли
// это запуск. Новое действие только замечается: иначе созданное в среду
// с расписанием на понедельник запустилось бы сразу.
export type Run = { at: number; ran: boolean };

// Действия, чей срок по расписанию прошёл после прошлого раза. Пока
// приложение закрыто, срок не теряется: он ждёт открытия.
export function dueActions(actions: Action[], runs: Record<string, Run>, now: Date) {
  return actions.filter((action) => {
    const run = runs[action.path];

    if (action.schedule === null || run === undefined) {
      return false;
    }

    const slot = lastSlot(action.schedule, now);

    return slot !== null && run.at < slot.getTime();
  });
}

// Дата ГГГГ-ММ-ДД по часам устройства.
export function dateOf(moment: Date) {
  return moment.toLocaleDateString("sv-SE");
}

// Задание к запуску: {{since}} это дата прошлого запуска, а первый раз
// неделя назад, {{today}} это сегодня.
export function taskAt(action: Action, run: Run | undefined, now: Date) {
  let since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

  if (run?.ran) {
    since = new Date(run.at);
  }

  return action.task.replaceAll("{{since}}", dateOf(since)).replaceAll("{{today}}", dateOf(now));
}

function parseAction({ path, text }: Note): Action {
  const { yaml, body } = splitFrontmatter(text);
  const hotkeyText = frontmatterValue(yaml, "hotkey") ?? "";
  const scheduleText = frontmatterValue(yaml, "schedule") ?? "";
  const schedule = parseSchedule(scheduleText);
  const problems: ActionProblem[] = [];
  const task = body.trim();
  let hotkey = parseHotkey(hotkeyText);

  if (task === "") {
    problems.push("emptyTask");
  }

  if (scheduleText !== "" && schedule === null) {
    problems.push("badSchedule");
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
    name: path.replace(/\.md$/, ""),
    task,
    hotkey,
    hotkeyText,
    schedule,
    scheduleText,
    problems,
  };
}

// Действия из файлов папки по алфавиту. Одно сочетание у двух действий
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

// Коды те же, что у проверки имени действия в Rust: окно подсказывает
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

// Сочетание, которое не занято приложением и другими действиями. Своё
// сочетание у правленого действия (self) не в счёт.
export function hotkeyProblem(
  hotkey: string,
  actions: Action[],
  self: string | null = null,
): "reservedHotkey" | "takenHotkey" | null {
  if (RESERVED.has(hotkey)) {
    return "reservedHotkey";
  }

  if (actions.some((action) => action.path !== self && action.hotkey === hotkey)) {
    return "takenHotkey";
  }

  return null;
}

// Текст файла действия. Шапка с обоими ключами, даже пустыми: так их
// видно, если файл откроют руками.
export function actionText(task: string, hotkey: string | null, schedule: string) {
  return `---\nhotkey: ${hotkey ?? ""}\nschedule: ${schedule.trim()}\n---\n${task.trim()}\n`;
}
