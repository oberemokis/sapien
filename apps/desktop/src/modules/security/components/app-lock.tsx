import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon";
import { useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { useIdleLock, useLocked, useShortcutsBlocked, useUnlock } from "../interactions/lock";

// Глухая заглушка на всё окно. Модальное окно встаёт поверх остальных
// в верхнем слое, даже открытых поиска и истории, и делает страницу под
// собой недоступной. Сама страница остаётся на месте: действия по
// расписанию идут, несохранённая правка не теряется.
function LockScreen() {
  const { t } = useTranslation();
  const { unlock, checking, failure } = useUnlock();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useShortcutsBlocked();
  // До отрисовки: содержимое не должно мелькнуть ни на кадр.
  useLayoutEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    // Escape заглушку не закрывает.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none flex-col bg-shell text-content backdrop:bg-shell"
      onCancel={(event) => event.preventDefault()}
    >
      {/* За шапку окно двигается и закрытым. */}
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-10 text-[13px]">
        <Icon icon={SquareLock02Icon} size={28} className="text-content/50" />
        <h2 id={titleId} className="text-sm font-semibold">
          {t("security.lock.screen.title")}
        </h2>
        <Button disabled={checking} onClick={unlock}>
          {t("security.lock.screen.unlock")}
        </Button>
        {failure === "failed" && (
          <p role="alert" className="text-diff-del-fg">
            {t("security.lock.screen.failed")}
          </p>
        )}
      </div>
    </dialog>
  );
}

// Блокировка окна после бездействия, если её включили в «Безопасности».
export function AppLock() {
  useIdleLock();
  const locked = useLocked();

  if (!locked) {
    return null;
  }

  return <LockScreen />;
}
