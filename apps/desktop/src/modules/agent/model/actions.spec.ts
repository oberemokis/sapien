import { describe, expect, it } from "vitest";
import {
  actionsOf,
  actionText,
  DIGEST_ACTION,
  dueActions,
  hotkeyOf,
  isRunnable,
  lastSlot,
  nameProblem,
  parseHotkey,
  parseSchedule,
  taskAt,
} from "./actions";

const note = (name: string, text: string) => ({ path: `Действия/${name}.md`, text });

describe("действия из заметок", () => {
  it("название из имени файла, задание из текста под шапкой, интеграции и клавиша из шапки", () => {
    const [action] = actionsOf([
      note("Задачи на сегодня", "---\nintegrations: [youtrack]\nhotkey: mod+shift+t\n---\nСобери задачи\n"),
    ]);

    expect(action).toEqual({
      path: "Действия/Задачи на сегодня.md",
      name: "Задачи на сегодня",
      task: "Собери задачи",
      integrations: ["youtrack"],
      hotkey: "Mod+Shift+T",
      hotkeyText: "mod+shift+t",
      schedule: null,
      scheduleText: "",
      problems: [],
    });
  });

  it("значения шапки встают в задание, а незаполненное держит запуск", () => {
    const [filled, empty] = actionsOf([
      note("А", "---\nepic: SAP-1\n---\nСводка по {{epic}} с {{since}}"),
      note("Б", "---\nepic:\n---\nСводка по {{epic}}"),
    ]);

    expect(filled).toMatchObject({ task: "Сводка по SAP-1 с {{since}}", problems: [] });
    expect(empty?.problems).toEqual(["emptyValue"]);
    expect([filled, empty].map((action) => action !== undefined && isRunnable(action))).toEqual([true, false]);
  });

  it("готовая сводка по эпику ждёт эпика в шапке, расписание у неё по понедельникам", () => {
    const [digest] = actionsOf([note(DIGEST_ACTION.name, DIGEST_ACTION.text)]);

    expect(digest).toMatchObject({
      integrations: ["youtrack"],
      schedule: { days: [1], minutes: 600 },
      problems: ["emptyValue"],
    });
  });
});

describe("расписание", () => {
  it.each([
    ["Mon 10:00", { days: [1], minutes: 600 }],
    ["пн, чт 9:30", { days: [1, 4], minutes: 570 }],
    ["fri,MON 18:05", { days: [1, 5], minutes: 1085 }],
    ["7:00", { days: [], minutes: 420 }],
    ["Mon", null],
    ["Mon 25:00", null],
    ["понедельник 10:00", null],
  ])("%s", (raw, schedule) => {
    expect(parseSchedule(raw)).toEqual(schedule);
  });

  // Пятница 30 октября 2026 года, 12:00 по часам устройства.
  const friday = new Date(2026, 9, 30, 12, 0);

  it("последний срок не позже сейчас, за прошедшую неделю", () => {
    expect(lastSlot({ days: [1], minutes: 600 }, friday)).toEqual(new Date(2026, 9, 26, 10, 0));
    expect(lastSlot({ days: [5], minutes: 720 }, friday)).toEqual(friday);
    expect(lastSlot({ days: [5], minutes: 721 }, friday)).toEqual(new Date(2026, 9, 23, 12, 1));
    expect(lastSlot({ days: [], minutes: 780 }, friday)).toEqual(new Date(2026, 9, 29, 13, 0));
  });

  it("срок прошёл после прошлого запуска, а новое действие ещё не замечено", () => {
    const actions = actionsOf([
      note("Еженедельное", "---\nschedule: Mon 10:00\n---\nзадание"),
      note("Ежедневное", "---\nschedule: 13:00\n---\nзадание"),
      note("Новое", "---\nschedule: Mon 10:00\n---\nзадание"),
    ]);
    const runs = {
      "Действия/Еженедельное.md": { at: new Date(2026, 9, 26, 9, 0).getTime(), ran: true },
      "Действия/Ежедневное.md": { at: new Date(2026, 9, 29, 14, 0).getTime(), ran: true },
    };

    expect(dueActions(actions, runs, friday).map((action) => action.name)).toEqual(["Еженедельное"]);
  });

  it("период задания от прошлого запуска, а первый раз неделя", () => {
    const [action] = actionsOf([note("А", "с {{since}} по {{today}}")]);

    if (action === undefined) {
      throw new Error("нет действия");
    }

    expect(taskAt(action, { at: new Date(2026, 9, 26, 10, 0).getTime(), ran: true }, friday)).toBe(
      "с 2026-10-26 по 2026-10-30",
    );
    expect(taskAt(action, { at: new Date(2026, 9, 29, 9, 0).getTime(), ran: false }, friday)).toBe(
      "с 2026-10-23 по 2026-10-30",
    );
    expect(taskAt(action, undefined, friday)).toBe("с 2026-10-23 по 2026-10-30");
  });

  it("интеграции списком строк, в кавычках и в любом регистре", () => {
    const [action] = actionsOf([note("А", "---\nintegrations:\n  - 'YouTrack'\n---\nзадание")]);

    expect(action?.integrations).toEqual(["youtrack"]);
  });

  it("без шапки весь текст это задание, клавиши и интеграций нет", () => {
    const [action] = actionsOf([note("А", "Просто задание")]);

    expect(action).toMatchObject({ task: "Просто задание", integrations: [], hotkey: null, problems: [] });
  });

  it("то, что не разобрать, видно причиной, а не молча пропадает", () => {
    const actions = actionsOf([
      note("Пустое", "---\nhotkey: Mod+K\n---\n"),
      note("Кривое", "---\nintegrations: [jira]\nhotkey: Shift+T\n---\nзадание"),
    ]);

    expect(actions.map(({ name, hotkey, problems }) => ({ name, hotkey, problems }))).toEqual([
      { name: "Кривое", hotkey: null, problems: ["unknownIntegration", "badHotkey"] },
      { name: "Пустое", hotkey: null, problems: ["emptyTask", "reservedHotkey"] },
    ]);
  });

  it("одна клавиша у двух действий не срабатывает ни у одного", () => {
    const actions = actionsOf([
      note("А", "---\nhotkey: Mod+Shift+1\n---\nзадание"),
      note("Б", "---\nhotkey: Mod+Shift+1\n---\nзадание"),
      note("В", "---\nhotkey: Mod+Shift+2\n---\nзадание"),
    ]);

    expect(actions.map((action) => action.hotkey)).toEqual([null, null, "Mod+Shift+2"]);
    expect(actions[0]?.problems).toEqual(["takenHotkey"]);
  });

  it("файл нового действия читается обратно тем же действием", () => {
    const text = actionText("  Собери задачи \n", ["youtrack"], "Mod+Alt+J");
    const [action] = actionsOf([note("А", text)]);

    expect(action).toMatchObject({ task: "Собери задачи", integrations: ["youtrack"], hotkey: "Mod+Alt+J" });
    expect(actionsOf([note("А", actionText("задание", [], null))])[0]?.problems).toEqual([]);
  });
});

describe("горячая клавиша", () => {
  it.each([
    ["Mod+Shift+T", "Mod+Shift+T"],
    ["shift + mod + t", "Mod+Shift+T"],
    ["Mod+F5", "Mod+F5"],
    ["Mod+Alt+Shift+9", "Mod+Alt+Shift+9"],
    ["Shift+T", null],
    ["Mod+Ctrl+T", null],
    ["Mod+Enter", null],
    ["Mod+", null],
  ])("%s", (raw, hotkey) => {
    expect(parseHotkey(raw)).toBe(hotkey);
  });

  // В тестах не macOS: Mod это Ctrl.
  it("нажатие берётся по месту клавиши: Alt на macOS не меняет букву", () => {
    const mod = { metaKey: false, ctrlKey: true };

    expect(hotkeyOf({ code: "KeyJ", altKey: true, shiftKey: false, ...mod })).toBe("Mod+Alt+J");
    expect(hotkeyOf({ code: "Digit3", altKey: false, shiftKey: true, ...mod })).toBe("Mod+Shift+3");
    expect(hotkeyOf({ code: "KeyJ", altKey: true, shiftKey: false, metaKey: false, ctrlKey: false })).toBeNull();
    expect(hotkeyOf({ code: "ShiftLeft", altKey: false, shiftKey: true, ...mod })).toBeNull();
  });
});

describe("название нового действия", () => {
  const actions = actionsOf([note("Задачи", "задание")]);

  it.each([
    ["", "name_empty"],
    ["  ", "name_empty"],
    ["Отчёт: неделя", "name_forbidden"],
    [".скрытое", "name_hidden"],
    ["задачи", "name_taken"],
    ["Сводка", null],
  ])("«%s»", (name, problem) => {
    expect(nameProblem(name, actions)).toBe(problem);
  });
});
