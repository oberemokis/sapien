import type { IconSvgElement } from "@hugeicons/react";
import { Icon } from "./icon";

type Props = {
  icon: IconSvgElement;
  label: string;
  // Подпись сочетания из shortcutLabel: попадает в подсказку при наведении.
  shortcut?: string;
  // Кнопка-переключатель: включена ли сейчас.
  pressed?: boolean;
  onClick: () => void;
};

// Кнопка без подписи в верхней полосе окна. Имя для чтения с экрана даёт
// label, подсказка повторяет его вместе с сочетанием.
export function IconButton({ icon, label, shortcut, pressed, onClick }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut === undefined ? label : `${label} (${shortcut})`}
      className="grid size-7 place-items-center rounded-md text-icon-muted transition-colors duration-120 hover:bg-overlay-hover hover:text-icon-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-overlay-pressed aria-pressed:bg-overlay-pressed aria-pressed:text-icon-base"
      onClick={onClick}
    >
      <Icon icon={icon} size={15} />
    </button>
  );
}
