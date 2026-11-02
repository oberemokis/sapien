import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import type { IconSvgElement } from "@hugeicons/react";
import { useState } from "react";
import { ContextMenu, type MenuItem } from "./context-menu";
import { Icon } from "./icon";

type Props = {
  icon: IconSvgElement;
  // Что выбрано сейчас: видно на кнопке.
  value: string;
  // Что выбирают: вместе со значением даёт имя кнопки для чтения с экрана.
  label: string;
  items: MenuItem[];
  disabled?: boolean;
  // Цвет иконки: у модели свой, как у Claude.
  tint?: string;
  // Когда значение видно, например только в широком контейнере. Имя
  // кнопки для чтения с экрана остаётся полным.
  shown?: string;
};

// Кнопка с выбором из меню, как модель и доступ под полем ввода чата.
// Меню раскрывается вверх: поле ввода живёт внизу панели.
export function MenuButton({ icon, value, label, items, disabled = false, tint, shown = "" }: Props) {
  const [at, setAt] = useState<{ x: number; y: number; button: HTMLElement } | null>(null);

  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${value}`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        disabled={disabled}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-text-muted transition-colors duration-120 hover:bg-overlay-hover hover:text-text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus aria-expanded:bg-overlay-pressed aria-expanded:text-text-base disabled:opacity-50"
        onClick={(event) => {
          if (at !== null) {
            setAt(null);
            return;
          }

          const button = event.currentTarget;
          const { left, top } = button.getBoundingClientRect();

          setAt({ x: left, y: top - 4, button });
        }}
      >
        <Icon icon={icon} size={14} className={tint} />
        <span className={`truncate ${shown}`}>{value}</span>
        <Icon icon={ArrowDown01Icon} size={12} className="shrink-0 text-icon-muted" />
      </button>
      {at !== null && (
        <ContextMenu x={at.x} y={at.y} above anchor={at.button} items={items} onClose={() => setAt(null)} />
      )}
    </>
  );
}
