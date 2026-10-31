import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { useLocked } from "../interactions/lock";
import { useResetData, useSecurityStatus } from "../interactions/security";
import { isUnreadable, type DataState } from "../model/security";

function UnreadableDialog({ state }: { state: DataState }) {
  const { t } = useTranslation();
  const { reset, resetting, failed } = useResetData();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    // Escape окно не закрывает: без чтения данных приложения не сохранится
    // и правка заметки, ей нужна история версий.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed inset-x-0 top-[20vh] mx-auto flex w-[min(520px,calc(100vw-32px))] flex-col gap-3 rounded-xl border border-content/8 bg-shell/95 p-5 text-[13px] text-content shadow-float backdrop-blur-xl backdrop:bg-scrim"
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t("security.unreadable.title")}
      </h2>
      <p className="text-content/70">{t(`security.unreadable.${state === "lost" ? "lost" : "locked"}`)}</p>
      <p className="text-content/70">{t("security.unreadable.notes")}</p>
      {failed && (
        <p role="alert" className="text-diff-del-fg">
          {t("security.unreadable.failed")}
        </p>
      )}
      <div className="flex justify-end">
        <Button disabled={resetting} onClick={reset}>
          {t("security.unreadable.reset")}
        </Button>
      </div>
    </dialog>
  );
}

// Ключ данных пропал или хранилище паролей не отвечает: окно поверх всего
// предлагает начать с чистыми данными приложения. Заметки это не трогает.
export function DataKeyNotice() {
  const status = useSecurityStatus();
  const locked = useLocked();

  // Модальное окно, открытое позже заглушки блокировки, встало бы поверх
  // неё, поэтому оно ждёт разблокировки.
  if (locked || status === undefined || !isUnreadable(status.data)) {
    return null;
  }

  return <UnreadableDialog state={status.data} />;
}
