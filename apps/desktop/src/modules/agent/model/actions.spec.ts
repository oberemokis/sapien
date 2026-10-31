import { describe, expect, it } from "vitest";
import { actionsOf, actionText, hotkeyOf, nameProblem, parseHotkey } from "./actions";

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
      problems: [],
    });
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
