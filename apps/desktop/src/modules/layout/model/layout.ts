// Отступ рабочей области от краёв окна, слева и справа. Взят у MonoCode:
// полоса у края держит место, и карточка никогда не упирается в рамку окна.
export const GUTTER = 6;

// Ширина окна, которая не достаётся ни одной панели: отступы у краёв
// и рамка карточки по пикселю с каждой стороны.
export const FRAME_WIDTH = 2 * GUTTER + 2;

// Место под кнопки окна macOS в верхней полосе, как у MonoCode.
export const WINDOW_BUTTONS_WIDTH = 78;

export const EDITOR_MIN_WIDTH = 360;

export const FILES_PANEL = { min: 200, initial: 260, max: 560 } as const;
export const CHAT_PANEL = { min: 280, initial: 360, max: 640 } as const;

export type PanelState = { open: boolean; width: number };

// Что выбрал пользователь. Сколько из этого помещается, считает fitLayout:
// узкое окно прячет панель, но выбор не трогает, и в широком она вернётся.
export type LayoutState = { files: PanelState; chat: PanelState };

export type FittedPanel = { visible: boolean; width: number };

export type FittedLayout = { files: FittedPanel; chat: FittedPanel };

export const INITIAL_LAYOUT: LayoutState = {
  files: { open: true, width: FILES_PANEL.initial },
  chat: { open: true, width: CHAT_PANEL.initial },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, unknown>;
  }

  return {};
}

function parsePanel(raw: unknown, fallback: PanelState): PanelState {
  const { open, width } = asRecord(raw);

  if (typeof open !== "boolean" || typeof width !== "number" || !Number.isFinite(width)) {
    return fallback;
  }

  return { open, width };
}

// Сохранённое могло побиться: каждая панель тогда берёт значения
// по умолчанию отдельно, а приложение не падает.
export function parseLayout(raw: unknown): LayoutState {
  const panels = asRecord(raw);

  return {
    files: parsePanel(panels.files, INITIAL_LAYOUT.files),
    chat: parsePanel(panels.chat, INITIAL_LAYOUT.chat),
  };
}

// Боковые панели не сжимаются меньше своего минимума, а редактор никогда
// не становится уже своего. Не хватает места, первым уходит чат: дерево
// файлов это навигация. Не хватает и дереву, уходит и оно.
export function fitLayout(layout: LayoutState, windowWidth: number): FittedLayout {
  const space = windowWidth - FRAME_WIDTH - EDITOR_MIN_WIDTH;
  const filesVisible = layout.files.open && space >= FILES_PANEL.min;
  const chatSpace = space - Number(filesVisible) * FILES_PANEL.min;
  const chatVisible = layout.chat.open && chatSpace >= CHAT_PANEL.min;

  const filesMax = Math.min(FILES_PANEL.max, space - Number(chatVisible) * CHAT_PANEL.min);
  const filesWidth = clamp(layout.files.width, FILES_PANEL.min, Math.max(filesMax, FILES_PANEL.min));
  const chatMax = Math.min(CHAT_PANEL.max, space - Number(filesVisible) * filesWidth);
  const chatWidth = clamp(layout.chat.width, CHAT_PANEL.min, Math.max(chatMax, CHAT_PANEL.min));

  return {
    files: { visible: filesVisible, width: filesWidth },
    chat: { visible: chatVisible, width: chatWidth },
  };
}

// Ширина после перетаскивания: столько, сколько панель реально заняла бы
// в этом окне. Иначе после отпускания в сохранённом лежало бы больше, чем
// видно, и при расширении окна панель прыгала бы.
export function resizePanel(
  layout: LayoutState,
  panel: keyof LayoutState,
  width: number,
  windowWidth: number,
): LayoutState {
  const requested = { ...layout, [panel]: { ...layout[panel], width } };

  return {
    ...requested,
    [panel]: { ...requested[panel], width: fitLayout(requested, windowWidth)[panel].width },
  };
}
