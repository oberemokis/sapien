import { useEffect, useRef, useState, type ReactNode } from "react";
import { GUTTER } from "../model/layout";

// Задержка перед тем, как панель спрячется: указатель успевает пересечь зазор
// между краем окна и панелью. Цифра MonoCode.
const CLOSE_DELAY = 180;

// Атрибут стоит на кнопке скрытия дерева в верхней полосе (workspace.tsx):
// наведение на неё тоже открывает панель.
const PEEK_TRIGGER = "[data-files-peek-trigger]";

// Открытое меню держит панель: указатель ушёл в него, а не с панели.
function menuOpen() {
  return document.querySelector('[role="menu"]') !== null;
}

type Props = { width: number; children: ReactNode };

// Скрытое дерево выезжает поверх содержимого, когда указатель у левого края
// окна или на кнопке скрытия. Содержимое под ним не сдвигается.
export function FilesPeek({ width, children }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Подписка пересобирается при смене open, чтобы обработчики видели текущее
  // значение. Таймер ухода снимает та же очистка.
  useEffect(() => {
    let closeTimer: number | undefined;

    function cancelClose() {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }

    function close() {
      cancelClose();
      setOpen(false);
    }

    function scheduleClose() {
      closeTimer ??= window.setTimeout(close, CLOSE_DELAY);
    }

    function inPanel(target: EventTarget | null) {
      return target instanceof Node && panelRef.current?.contains(target) === true;
    }

    function onPointerMove(event: PointerEvent) {
      const element = event.target instanceof Element ? event.target : null;
      const onTrigger =
        element?.closest(PEEK_TRIGGER) ||
        (event.clientX <= GUTTER && !element?.closest("[data-title-bar]"));

      if (onTrigger) {
        cancelClose();
        setOpen(true);
        return;
      }

      if (!open) {
        return;
      }

      // Протяжка с зажатой кнопкой тоже держит панель: выделение текста в ней
      // не обрывается на краю.
      if (inPanel(event.target) || event.buttons !== 0 || menuOpen()) {
        cancelClose();
        return;
      }

      scheduleClose();
    }

    function onPointerLeave() {
      if (open && !menuOpen()) {
        scheduleClose();
      }
    }

    // Нажатие мимо панели убирает её сразу, без задержки.
    function onPointerDown(event: PointerEvent) {
      const element = event.target instanceof Element ? event.target : null;

      if (!inPanel(event.target) && !element?.closest(PEEK_TRIGGER)) {
        close();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && open) {
        close();
      }
    }

    const root = document.documentElement;

    window.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelClose();
      window.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Панель всегда в разметке, а показ и уход анимирует CSS по data-open:
  // так у ухода есть время доиграть, и состояние «уходит» не нужно.
  return (
    <>
      <div
        aria-hidden
        data-open={open || undefined}
        className="pointer-events-none fixed inset-0 z-20 bg-scrim opacity-0 transition-opacity duration-200 ease-out data-open:opacity-100 motion-reduce:transition-none"
      />
      <aside
        ref={panelRef}
        data-open={open || undefined}
        inert={!open}
        style={{ width }}
        className="invisible fixed top-10 bottom-1.5 left-1.5 z-20 flex -translate-x-3 flex-col overflow-hidden rounded-[10px] border border-content/8 bg-shell/85 opacity-0 shadow-float backdrop-blur-xl transition-[opacity,translate,visibility] duration-200 ease-out data-open:visible data-open:translate-x-0 data-open:opacity-100 data-open:duration-240 motion-reduce:transition-none"
      >
        {children}
      </aside>
    </>
  );
}
