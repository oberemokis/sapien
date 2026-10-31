import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

// Обычная кнопка с подписью, как «Check for updates» в MonoCode.
export function Button({ children, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="rounded-md border border-stroke px-3 py-1.5 text-[13px] transition-colors duration-120 hover:bg-selection-hover disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
