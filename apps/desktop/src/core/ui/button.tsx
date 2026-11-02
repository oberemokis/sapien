import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

// Обычная кнопка с подписью, Button neutral из дизайн-системы. Наведение
// и нажатие кладут долю поверх заливки, а не меняют её.
export function Button({ children, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-bg-button-neutral px-[11px] text-[13px]/5 font-medium text-text-base shadow-button-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus enabled:hover:bg-[image:linear-gradient(var(--overlay-hover),var(--overlay-hover))] enabled:active:bg-[image:linear-gradient(var(--overlay-pressed),var(--overlay-pressed))] disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
