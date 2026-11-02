import { useState } from "react";
import { ContextMenu, type MenuItem } from "./context-menu";
import { Icon } from "./icon";

type Props = {
  // Что выбрано сейчас: видно на кнопке.
  value: string;
  // Подпись на кнопке, когда значение само по себе непонятно, например
  // «По умолчанию». Имя для чтения с экрана остаётся со значением.
  text?: string;
  // Что выбирают: вместе со значением даёт имя кнопки для чтения с экрана.
  label: string;
  items: MenuItem[];
  disabled?: boolean;
  // Цвет значения, когда выбор надо заметить: полный доступ агента.
  tint?: string;
};

// Кнопка с выбором из меню, как модель и доступ под полем ввода чата.
// Меню раскрывается вверх: поле ввода живёт внизу панели.
export function MenuButton({ value, text = value, label, items, disabled = false, tint = "" }: Props) {
  const [at, setAt] = useState<{ x: number; y: number; button: HTMLElement } | null>(null);

  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${value}`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        disabled={disabled}
        className="flex h-7 min-w-0 items-center gap-1 rounded-md px-2 text-[12px] text-text-muted transition-colors duration-120 hover:bg-overlay-hover hover:text-text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus aria-expanded:bg-overlay-pressed aria-expanded:text-text-base disabled:opacity-50"
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
        <span className={`truncate ${tint}`}>{text}</span>
        <Icon icon="chevron-down" size={14} className="shrink-0 text-icon-muted" />
      </button>
      {at !== null && (
        <ContextMenu x={at.x} y={at.y} above anchor={at.button} items={items} onClose={() => setAt(null)} />
      )}
    </>
  );
}
