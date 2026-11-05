import { Fragment, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon";

// Недоступный пункт виден серым с пометкой под названием, почему. separated
// отделяет пункт и следующие за ним чертой сверху, heading подписывает
// группу над пунктом. checked делает пункт выбором из нескольких с галочкой.
// critical красит пункт, который удаляет или убирает. id нужен, когда
// подписи пунктов повторяются в разных группах.
export type MenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  critical?: boolean;
  hint?: string;
  separated?: boolean;
  heading?: string;
  checked?: boolean;
  id?: string;
};

type Props = {
  // Точка, где нажали правую кнопку, в координатах окна.
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  // Меню встаёт над точкой, а не под ней: так открывается меню у поля ввода
  // внизу панели.
  above?: boolean;
  // Нажатие на этот элемент меню не закрывает: его кнопка закрывает сама.
  anchor?: HTMLElement | null;
};

// Отступ меню от края окна, когда у точки нажатия ему не хватает места.
const EDGE = 4;

const ITEM = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

// Стрелки ходят по кругу: вниз с последнего пункта на первый.
function moveFocus(menu: HTMLElement, step: number) {
  const items = [...menu.querySelectorAll<HTMLElement>(ITEM)];
  const index = items.findIndex((item) => item === document.activeElement);

  items.at((index + step) % items.length)?.focus();
}

// Своё меню вместо системного: одно и то же в окне, в браузере и в тестах.
// Висит поверх всего у точки нажатия и уходит от нажатия мимо, Escape и Tab.
export function ContextMenu({ x, y, items, onClose, above = false, anchor = null }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Меню у правого или нижнего края сдвигается внутрь окна. Размер известен
  // только после отрисовки, поэтому место ставится до того, как его покажут.
  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (menu === null) {
      return;
    }

    const { width, height } = menu.getBoundingClientRect();
    let top = y;

    if (above) {
      top = y - height;
    }

    menu.style.left = `${Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE))}px`;
    menu.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE))}px`;
    menu.querySelector<HTMLElement>(ITEM)?.focus();
  }, [x, y, above]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const inside = (node: Element | null) => event.target instanceof Node && node?.contains(event.target) === true;

      if (!inside(menuRef.current) && !inside(anchor)) {
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
  }, [onClose, anchor]);

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
      // Ширина по содержимому, а не по месту до края окна: у края меню иначе
      // сжимается до того, как его сдвинут влево.
      className="fixed z-30 w-max max-w-[calc(100vw-8px)] min-w-40 rounded-md bg-bg-layer-01 p-0.5 shadow-floating"
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <Fragment key={item.id ?? item.label}>
          {item.separated === true && <hr className="-mx-0.5 my-0.5 border-border-muted" />}
          {item.heading !== undefined && (
            <p role="presentation" className="flex h-7 items-center px-3 text-[11px] font-medium text-text-faint">
              {item.heading}
            </p>
          )}
          <button
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked}
            disabled={item.disabled}
            className={`flex min-h-7 w-full items-center gap-4 rounded-sm py-1 pr-1.5 pl-3 text-left text-[13px] outline-none transition-colors duration-120 hover:bg-overlay-hover focus-visible:bg-overlay-hover disabled:opacity-50 disabled:hover:bg-transparent ${
              item.critical === true ? "text-state-fg-danger" : ""
            }`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {/* Подсказка стоит под названием пункта, а не рядом. */}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{item.label}</span>
              {item.hint !== undefined && <span className="text-[12px]/4 text-text-faint">{item.hint}</span>}
            </span>
            {item.checked !== undefined && (
              <span className="grid size-3.5 shrink-0 place-items-center">
                {item.checked && <Icon icon="check" size={14} />}
              </span>
            )}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
