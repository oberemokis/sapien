import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  disabled?: boolean;
  // submit для главного действия рядом с обычными: «Разрешить», «Создать».
  // danger для действия, которое удаляет или отключает: «Убрать», «Отключить».
  variant?: "neutral" | "submit" | "danger";
  onClick: () => void;
};

const BASE =
  "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-[11px] text-[13px]/5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus";

// danger отличается от neutral только цветом текста.
const NEUTRAL =
  "bg-bg-button-neutral shadow-button-neutral enabled:hover:bg-[image:linear-gradient(var(--overlay-hover),var(--overlay-hover))] enabled:active:bg-[image:linear-gradient(var(--overlay-pressed),var(--overlay-pressed))] disabled:opacity-50";

const VARIANT = {
  neutral: `${NEUTRAL} text-text-base`,
  danger: `${NEUTRAL} text-state-fg-danger`,
  submit:
    "bg-bg-submit text-text-submit shadow-button-contrast enabled:hover:bg-[image:linear-gradient(rgb(0_0_0/0.08),rgb(0_0_0/0.08))] disabled:opacity-40",
};

// Кнопка с подписью, Button дизайн-системы. Наведение и нажатие кладут долю
// поверх заливки, а не меняют её.
export function Button({ children, disabled, variant = "neutral", onClick }: Props) {
  return (
    <button type="button" disabled={disabled} className={`${BASE} ${VARIANT[variant]}`} onClick={onClick}>
      {children}
    </button>
  );
}
