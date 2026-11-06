import type { ReactNode } from "react";

// Действие внутри плашки, как link-action дизайн-системы.
export const LINK =
  "shrink-0 text-[13px] font-medium underline decoration-text-base/40 underline-offset-2 hover:decoration-text-base";

const TONES = {
  danger: "bg-state-bg-danger shadow-[inset_0_0_0_0.5px_var(--state-border-danger)]",
  warning: "bg-state-bg-warning shadow-[inset_0_0_0_0.5px_var(--state-border-warning)]",
};

type NoticeProps = { children: string; action?: ReactNode; tone?: keyof typeof TONES };

// Плашка, как Banner дизайн-системы: терминалу негде работать или с ним
// что-то случилось.
export function Notice({ children, action, tone = "danger" }: NoticeProps) {
  return (
    <div
      role="alert"
      className={`mx-auto mt-4 flex w-full max-w-200 items-center gap-3 rounded-md px-3 py-2 text-[13px]/5 ${TONES[tone]}`}
    >
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}
