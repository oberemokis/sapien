import { describe, expect, it } from "vitest";
import {
  CHAT_PANEL,
  EDITOR_MIN_WIDTH,
  FILES_PANEL,
  FRAME_WIDTH,
  INITIAL_LAYOUT,
  fitLayout,
  parseLayout,
  resizePanel,
  type LayoutState,
} from "./layout";

// Окно, в которое три панели входят ровно на своих минимумах.
const TIGHT = FRAME_WIDTH + EDITOR_MIN_WIDTH + FILES_PANEL.min + CHAT_PANEL.min;

function editorWidth(layout: LayoutState, windowWidth: number) {
  const { files, chat } = fitLayout(layout, windowWidth);

  return (
    windowWidth -
    FRAME_WIDTH -
    Number(files.visible) * files.width -
    Number(chat.visible) * chat.width
  );
}

describe("раскладка окна", () => {
  it("в широком окне обе панели видны со своей шириной", () => {
    expect(fitLayout(INITIAL_LAYOUT, 1600)).toEqual({
      files: { visible: true, width: FILES_PANEL.initial },
      chat: { visible: true, width: CHAT_PANEL.initial },
    });
  });

  it.each([
    ["обе на минимумах", TIGHT, true, true],
    ["чат уходит первым", TIGHT - 1, true, false],
    ["дерево держится до своего минимума", FRAME_WIDTH + EDITOR_MIN_WIDTH + FILES_PANEL.min, true, false],
    ["уходит и дерево", FRAME_WIDTH + EDITOR_MIN_WIDTH + FILES_PANEL.min - 1, false, false],
  ])("%s", (_, windowWidth, files, chat) => {
    const fitted = fitLayout(INITIAL_LAYOUT, windowWidth);

    expect([fitted.files.visible, fitted.chat.visible]).toEqual([files, chat]);
    expect(fitted.files.width).toBeGreaterThanOrEqual(FILES_PANEL.min);
    expect(fitted.chat.width).toBeGreaterThanOrEqual(CHAT_PANEL.min);
  });

  it("редактор не уже минимума ни при какой ширине окна и панелей", () => {
    for (let windowWidth = 400; windowWidth <= 2400; windowWidth += 37) {
      for (const files of [0, 150, 260, 560, 900]) {
        for (const chat of [0, 280, 360, 640, 1200]) {
          const layout = {
            files: { open: true, width: files },
            chat: { open: true, width: chat },
          };
          const fitted = fitLayout(layout, windowWidth);

          if (fitted.files.visible || fitted.chat.visible) {
            expect(editorWidth(layout, windowWidth)).toBeGreaterThanOrEqual(EDITOR_MIN_WIDTH);
          }
        }
      }
    }
  });

  it("закрытая пользователем панель не появляется и в широком окне", () => {
    const layout = { ...INITIAL_LAYOUT, chat: { open: false, width: CHAT_PANEL.initial } };

    expect(fitLayout(layout, 2400).chat.visible).toBe(false);
  });

  it("перетаскивание не даёт дереву забрать место чата и редактора", () => {
    const layout = resizePanel(INITIAL_LAYOUT, "files", 900, 1000);

    expect(layout.files.width).toBe(1000 - FRAME_WIDTH - EDITOR_MIN_WIDTH - CHAT_PANEL.min);
  });

  it("перетаскивание не сжимает панель меньше минимума", () => {
    expect(resizePanel(INITIAL_LAYOUT, "chat", 10, 1600).chat.width).toBe(CHAT_PANEL.min);
  });

  it.each([
    ["пусто", null],
    ["не объект", "wide"],
    ["чужие поля", { files: { open: "yes", width: "big" } }],
    ["бесконечность", { files: { open: true, width: Infinity } }],
  ])("битое сохранённое (%s) даёт раскладку по умолчанию", (_, raw) => {
    expect(parseLayout(raw)).toEqual(INITIAL_LAYOUT);
  });

  it("целая панель сохраняется, даже если соседняя побита", () => {
    const files = { open: false, width: 300 };

    expect(parseLayout({ files, chat: 42 })).toEqual({ files, chat: INITIAL_LAYOUT.chat });
  });
});
