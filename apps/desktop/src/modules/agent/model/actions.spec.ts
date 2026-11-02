import { describe, expect, it } from "vitest";
import {
  actionsOf,
  actionText,
  dueActions,
  hotkeyOf,
  hotkeyProblem,
  lastSlot,
  nameProblem,
  parseHotkey,
  parseSchedule,
  taskAt,
} from "./actions";

// Действие лежит файлом в папке приложения: путь это имя файла.
const file = (name: string, text: string) => ({ path: `${name}.md`, text });

describe("действия из файлов", () => {
  it("название из имени файла, задание из текста под шапкой, клавиша и расписание из шапки", () => {
    const [action] = actionsOf([
      file("Задачи на сегодня", "---\nhotkey: mod+shift+t\nschedule: пн 9:30\n---\nСобери задачи\n"),
    ]);

    expect(action).toEqual({
      path: "Задачи на сегодня.md",
      name: "Задачи на сегодня",
      task: "Собери задачи",
      hotkey: "Mod+Shift+T",
      hotkeyText: "mod+shift+t",
      schedule: { days: [1], minutes: 570 },
      scheduleText: "пн 9:30",
      problems: [],
    });
  });

  it("без шапки весь текст это задание, клавиши и расписания нет", () => {
    const [action] = actionsOf([file("А", "Просто задание")]);

    expect(action).toMatchObject({ task: "Просто задание", hotkey: null, schedule: null, problems: [] });
  });

  it("действия идут по алфавиту", () => {
    const actions = actionsOf([file("Ёлка", "з"), file("Бета", "з"), file("Альфа", "з")]);

    expect(actions.map((action) => action.name)).toEqual(["Альфа", "Бета", "Ёлка"]);
  });

  it("то, что не разобрать, видно причиной, а не молча пропадает", () => {
    const actions = actionsOf([
      file("Пустое", "---\nhotkey: Mod+K\n---\n"),
      file("Кривое", "---\nhotkey: Shift+T\nschedule: понедельник\n---\nзадание"),
    ]);

    expect(actions.map(({ name, hotkey, schedule, problems }) => ({ name, hotkey, schedule, problems }))).toEqual([
      { name: "Кривое", hotkey: null, schedule: null, problems: ["badSchedule", "badHotkey"] },
      { name: "Пустое", hotkey: null, schedule: null, problems: ["emptyTask", "reservedHotkey"] },
    ]);
  });

  it("одна клавиша у двух действий не срабатывает ни у одного", () => {
    const actions = actionsOf([
      file("А", "---\nhotkey: Mod+Shift+1\n---\nзадание"),
      file("Б", "---\nhotkey: Mod+Shift+1\n---\nзадание"),
      file("В", "---\nhotkey: Mod+Shift+2\n---\nзадание"),
    ]);

    expect(actions.map((action) => action.hotkey)).toEqual([null, null, "Mod+Shift+2"]);
    expect(actions[0]?.problems).toEqual(["takenHotkey"]);
  });

  it("файл нового действия читается обратно тем же действием", () => {
    const [full] = actionsOf([file("А", actionText("  Собери задачи \n", "Mod+Alt+J", " пн, чт 10:00 "))]);
    const [plain] = actionsOf([file("Б", actionText("задание", null, ""))]);

    expect(full).toMatchObject({
      task: "Собери задачи",
      hotkey: "Mod+Alt+J",
      schedule: { days: [1, 4], minutes: 600 },
      scheduleText: "пн, чт 10:00",
      problems: [],
    });
    expect(plain).toMatchObject({ task: "задание", hotkey: null, schedule: null, problems: [] });
  });
});

describe("расписание", () => {
  it.each([
    ["Mon 10:00", { days: [1], minutes: 600 }],
    ["пн, чт 9:30", { days: [1, 4], minutes: 570 }],
    ["fri,MON 18:05", { days: [1, 5], minutes: 1085 }],
    ["пн пн 8:00", { days: [1], minutes: 480 }],
    ["7:00", { days: [], minutes: 420 }],
    ["Mon", null],
    ["Mon 25:00", null],
    ["Mon 10:60", null],
    ["понедельник 10:00", null],
    ["", null],
  ])("«%s»", (raw, schedule) => {
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
      file("Еженедельное", "---\nschedule: Mon 10:00\n---\nзадание"),
      file("Ежедневное", "---\nschedule: 13:00\n---\nзадание"),
      file("Новое", "---\nschedule: Mon 10:00\n---\nзадание"),
      file("Без расписания", "задание"),
    ]);
    const runs = {
      "Еженедельное.md": { at: new Date(2026, 9, 26, 9, 0).getTime(), ran: true },
      "Ежедневное.md": { at: new Date(2026, 9, 29, 14, 0).getTime(), ran: true },
      "Без расписания.md": { at: 0, ran: true },
    };

    expect(dueActions(actions, runs, friday).map((action) => action.name)).toEqual(["Еженедельное"]);
  });

  it("период задания от прошлого запуска, а первый раз неделя", () => {
    const [action] = actionsOf([file("А", "с {{since}} по {{today}}")]);

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

  it("нажатие берётся по месту клавиши: Alt на macOS не меняет букву", () => {
    const mod = { metaKey: true, ctrlKey: false };

    expect(hotkeyOf({ code: "KeyJ", altKey: true, shiftKey: false, ...mod })).toBe("Mod+Alt+J");
    expect(hotkeyOf({ code: "Digit3", altKey: false, shiftKey: true, ...mod })).toBe("Mod+Shift+3");
    expect(hotkeyOf({ code: "KeyJ", altKey: true, shiftKey: false, metaKey: false, ctrlKey: false })).toBeNull();
    expect(hotkeyOf({ code: "ShiftLeft", altKey: false, shiftKey: true, ...mod })).toBeNull();
  });

  describe("занятое сочетание", () => {
    const actions = actionsOf([
      file("Обзор", "---\nhotkey: Mod+Shift+J\n---\nзадание"),
      file("Сводка", "---\nhotkey: Mod+Shift+S\n---\nзадание"),
    ]);

    it.each([
      ["Mod+K", null, "reservedHotkey"],
      ["Mod+Shift+Z", "Обзор.md", "reservedHotkey"],
      ["Mod+Shift+J", null, "takenHotkey"],
      ["Mod+Shift+S", "Обзор.md", "takenHotkey"],
      ["Mod+Shift+J", "Обзор.md", null],
      ["Mod+Shift+U", null, null],
    ])("%s у действия %s", (hotkey, self, problem) => {
      expect(hotkeyProblem(hotkey, actions, self)).toBe(problem);
    });
  });
});

describe("название нового действия", () => {
  const actions = actionsOf([file("Задачи", "задание")]);

  it.each([
    ["", "name_empty"],
    ["  ", "name_empty"],
    ["Отчёт: неделя", "name_forbidden"],
    ["план/факт", "name_forbidden"],
    [".скрытое", "name_hidden"],
    ["задачи", "name_taken"],
    [" Задачи ", "name_taken"],
    ["Сводка", null],
  ])("«%s»", (name, problem) => {
    expect(nameProblem(name, actions)).toBe(problem);
  });
});
