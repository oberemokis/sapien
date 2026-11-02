import type { ReactNode } from "react";

// Действие внутри плашки, как link-action дизайн-системы.
export const ALERT_ACTION =
  "shrink-0 font-medium underline decoration-text-base/40 underline-offset-2 hover:decoration-text-base";

// Плашка о том, что не вышло, с действием справа, как Banner дизайн-системы.
export function Alert({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md bg-state-bg-danger px-3 py-2 text-[13px]/5 text-text-base shadow-[inset_0_0_0_0.5px_var(--state-border-danger)]"
    >
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function AlertAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={ALERT_ACTION} onClick={onClick}>
      {children}
    </button>
  );
}
