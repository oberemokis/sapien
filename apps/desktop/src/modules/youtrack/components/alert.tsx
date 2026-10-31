import type { ReactNode } from "react";

// Плашка о том, что не вышло, с действием справа.
export function Alert({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md bg-diff-del-bg px-3 py-2">
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function AlertAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="shrink-0 underline underline-offset-2" onClick={onClick}>
      {children}
    </button>
  );
}
