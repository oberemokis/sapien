// Масштаб интерфейса в процентах, как масштаб страницы в браузере.
export const UI_SCALES = [80, 90, 100, 110, 120] as const;

export type UiScale = (typeof UI_SCALES)[number];

// В 100% интерфейс крупноват для окна с панелями и чатом, поэтому по
// умолчанию он мельче.
export const DEFAULT_UI_SCALE: UiScale = 90;

// Сохранённое значение могло побиться или остаться от другой версии:
// тогда масштаб по умолчанию, а не падение на старте.
export function parseUiScale(raw: unknown): UiScale {
  return UI_SCALES.find((scale) => String(scale) === raw) ?? DEFAULT_UI_SCALE;
}
