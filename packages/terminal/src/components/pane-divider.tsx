// Разделитель с фокусом и aria-valuenow по ARIA 1.2 это виджет, его двигают
// мышью и стрелками. Правила jsx-a11y считают separator статичным.
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
import { useState, type KeyboardEvent, type PointerEvent } from "react";

// Шаг стрелки, когда границу двигают с клавиатуры: доля деления.
const KEY_STEP = 0.05;

type Props = {
  // row: панели слева и справа от границы, column: сверху и снизу.
  direction: "row" | "column";
  ratio: number;
  label: string;
  onResize: (ratio: number) => void;
  // Протяжка кончилась: раскладку можно запомнить.
  onDone: () => void;
};

// Граница между двумя панелями деления. Её тянут мышью, и доля первой
// панели считается от места деления на экране.
export function PaneDivider({ direction, ratio, label, onResize, onDone }: Props) {
  const [dragging, setDragging] = useState(false);
  const row = direction === "row";
  const cursor = row ? "cursor-col-resize" : "cursor-row-resize";

  function onPointerDown(event: PointerEvent<HTMLHRElement>) {
    // Иначе протяжка выделяет текст под указателем.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLHRElement>) {
    const box = event.currentTarget.parentElement?.getBoundingClientRect();

    if (!dragging || box === undefined) {
      return;
    }

    onResize(row ? (event.clientX - box.left) / box.width : (event.clientY - box.top) / box.height);
  }

  // Захват снимает и отпускание кнопки, и уход окна из фокуса посреди протяжки.
  function onLostPointerCapture() {
    setDragging(false);
    onDone();
  }

  function onKeyDown(event: KeyboardEvent<HTMLHRElement>) {
    const steps: Record<string, number> = row
      ? { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }
      : { ArrowUp: -KEY_STEP, ArrowDown: KEY_STEP };
    const step = steps[event.key];

    if (step === undefined) {
      return;
    }

    event.preventDefault();
    onResize(ratio + step);
    onDone();
  }

  return (
    <>
      {/* Место под указатель шире линии, а в раскладке граница места не занимает. */}
      <hr
        aria-orientation={row ? "vertical" : "horizontal"}
        aria-label={label}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={10}
        aria-valuemax={90}
        tabIndex={0}
        data-dragging={dragging || undefined}
        className={`relative z-10 m-0 shrink-0 border-0 touch-none outline-none before:absolute before:bg-border-muted before:transition-colors before:duration-120 hover:before:bg-border-focus focus-visible:before:bg-border-focus data-dragging:before:bg-border-focus ${cursor} ${
          row
            ? "-mx-1 h-auto w-2 before:inset-y-0 before:left-1/2 before:w-px"
            : "-my-1 h-2 w-auto before:inset-x-0 before:top-1/2 before:h-px"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onKeyDown}
      />
      {/* Пока тянут, курсор не меняется над терминалами. */}
      {dragging && <div className={`fixed inset-0 z-50 ${cursor}`} />}
    </>
  );
}
