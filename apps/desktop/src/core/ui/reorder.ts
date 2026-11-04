import { useRef, useState, type PointerEvent } from "react";

// Сдвиг указателя в пикселях, после которого нажатие становится
// перетаскиванием.
const DRAG_START = 4;

// Вкладки тащат вдоль строки, строки списка сверху вниз.
const AXES = {
  x: { at: (event: { clientX: number }) => event.clientX, middle: (box: DOMRect) => box.left + box.width / 2 },
  y: { at: (event: { clientY: number }) => event.clientY, middle: (box: DOMRect) => box.top + box.height / 2 },
};

// Куда встанет перетаскиваемый элемент id: перед элементом before,
// с null в конец.
export type Drop = { id: string; before: string | null };

// Перестановка элементов списка перетаскиванием вдоль оси axis. Элементы
// это дети list с data-id, start вешается на их нажатие. drop: куда встанет
// элемент, пока его тащат. Отпущенный после перетаскивания элемент нажатием
// не считается, это говорит pressed в его onClick.
export function useReorder(axis: keyof typeof AXES, onDrop: (drop: Drop) => void) {
  const list = useRef<HTMLUListElement>(null);
  const dragged = useRef(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const { at, middle } = AXES[axis];

  // Элемент, перед которым встанет перетаскиваемый, по середине элементов
  // под указателем.
  function beforeAt(point: number, id: string) {
    const shown = [...(list.current?.querySelectorAll<HTMLElement>(":scope > [data-id]") ?? [])];
    const found = shown.find((item) => item.dataset.id !== id && point < middle(item.getBoundingClientRect()));

    return found?.dataset.id ?? null;
  }

  function start(event: PointerEvent, id: string) {
    dragged.current = false;

    if (event.button !== 0) {
      return;
    }

    const from = at(event);
    let before: string | null | undefined;

    const move = (moved: globalThis.PointerEvent) => {
      if (before === undefined && Math.abs(at(moved) - from) < DRAG_START) {
        return;
      }

      before = beforeAt(at(moved), id);
      setDrop({ id, before });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDrop(null);

      if (before !== undefined) {
        dragged.current = true;
        onDrop({ id, before });
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function pressed() {
    const was = dragged.current;

    dragged.current = false;

    return !was;
  }

  return { list, drop, start, pressed };
}
