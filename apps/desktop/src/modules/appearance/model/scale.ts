// Масштаб интерфейса в процентах, как масштаб страницы в браузере.
export const UI_SCALES = [80, 90, 100, 110, 120] as const;

export type UiScale = (typeof UI_SCALES)[number];

// По умолчанию 100%: размеры текста и иконок взяты у opencode 2.0 под
// натуральный масштаб. Дробный масштаб уменьшает текст 13px до 11,7px
// и сдвигает линии иконок толщиной в пиксель между пикселями экрана, отчего
// они расплываются и кажутся бледными.
export const DEFAULT_UI_SCALE: UiScale = 100;

// Сохранённое значение могло побиться или остаться от другой версии:
// тогда масштаб по умолчанию, а не падение на старте.
export function parseUiScale(raw: unknown): UiScale {
  return UI_SCALES.find((scale) => String(scale) === raw) ?? DEFAULT_UI_SCALE;
}
