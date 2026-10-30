// Разделитель с фокусом и aria-valuenow по ARIA 1.2 это виджет, его двигают
// мышью и стрелками. Правила jsx-a11y считают separator статичным.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { resizeLayoutPanel, saveLayout } from "../interactions/layout";
import type { LayoutState } from "../model/layout";

// Шаг стрелки, когда ширину меняют с клавиатуры.
const KEY_STEP = 16;

type Props = {
  panel: keyof LayoutState;
  width: number;
  min: number;
  max: number;
  // Край панели, на котором стоит ручка: у дерева правый, у чата левый.
  edge: "left" | "right";
  label: string;
};

export function ResizeHandle({ panel, width, min, max, edge, label }: Props) {
  // Тянем ручку вправо: дерево у левого края растёт, чат у правого сжимается.
  const direction = edge === "right" ? 1 : -1;
  const start = useRef({ x: 0, width: 0 });
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: PointerEvent<HTMLHRElement>) {
    // Иначе протяжка выделяет текст под указателем.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLHRElement>) {
    if (!dragging) {
      return;
    }

    resizeLayoutPanel(panel, start.current.width + direction * (event.clientX - start.current.x));
  }

  // Захват снимает и отпускание кнопки, и уход окна из фокуса посреди протяжки.
  function onLostPointerCapture() {
    setDragging(false);
    saveLayout();
  }

  function onKeyDown(event: KeyboardEvent<HTMLHRElement>) {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];

    if (step === undefined) {
      return;
    }

    event.preventDefault();
    resizeLayoutPanel(panel, width + direction * step);
    saveLayout();
  }

  return (
    <>
      <hr
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-dragging={dragging || undefined}
        className={`absolute inset-y-0 z-10 m-0 h-auto w-1.5 cursor-col-resize border-0 touch-none outline-none transition-colors duration-120 hover:bg-selection-hover focus-visible:bg-selection-emphasis data-dragging:bg-selection-emphasis ${
          edge === "right" ? "-right-0.75" : "-left-0.75"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onKeyDown}
      />
      {/* Пока тянут, курсор не меняется над редактором и кнопками. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </>
  );
}
