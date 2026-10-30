import type { IconSvgElement } from "@hugeicons/react";
import { Icon } from "./icon";

type Props = {
  icon: IconSvgElement;
  label: string;
  // Подпись сочетания из shortcutLabel: попадает в подсказку при наведении.
  shortcut?: string;
  onClick: () => void;
};

// Кнопка без подписи в верхней полосе окна. Имя для чтения с экрана даёт
// label, подсказка повторяет его вместе с сочетанием.
export function IconButton({ icon, label, shortcut, onClick }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut === undefined ? label : `${label} (${shortcut})`}
      className="grid size-7 place-items-center rounded-md text-content/60 transition-colors duration-120 hover:bg-selection-hover hover:text-content"
      onClick={onClick}
    >
      <Icon icon={icon} size={15} />
    </button>
  );
}
