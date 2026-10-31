import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type MenuItem = { label: string; onSelect: () => void };

type Props = {
  // Точка, где нажали правую кнопку, в координатах окна.
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

// Отступ меню от края окна, когда у точки нажатия ему не хватает места.
const EDGE = 4;

// Стрелки ходят по кругу: вниз с последнего пункта на первый.
function moveFocus(menu: HTMLElement, step: number) {
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const index = items.findIndex((item) => item === document.activeElement);

  items.at((index + step) % items.length)?.focus();
}

// Своё меню вместо системного: одно и то же в окне, в браузере и в тестах.
// Висит поверх всего у точки нажатия и уходит от нажатия мимо, Escape и Tab.
export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Меню у правого или нижнего края сдвигается внутрь окна. Размер известен
  // только после отрисовки, поэтому место ставится до того, как его покажут.
  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (menu === null) {
      return;
    }

    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE))}px`;
    menu.style.top = `${Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE))}px`;
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node && menuRef.current?.contains(event.target))) {
        onClose();
      }
    }

    // Escape закрывает только меню: слушатель стоит на document в фазе
    // захвата и гасит событие раньше остальных, например выезжающей панели.
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }

    window.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onEscape, true);
    window.addEventListener("blur", onClose);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    }

    if (event.key === "Tab") {
      event.preventDefault();
      onClose();
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      className="fixed z-30 min-w-40 rounded-lg border border-content/8 bg-shell/85 p-1 shadow-float backdrop-blur-xl"
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] outline-none transition-colors duration-120 hover:bg-selection-hover focus-visible:bg-selection-hover"
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
