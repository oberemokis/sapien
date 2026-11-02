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
      className="fixed inset-x-0 top-[20vh] mx-auto flex w-[min(480px,calc(100vw-32px))] flex-col gap-2 rounded-md bg-bg-layer-01 p-4 text-[13px]/5 text-text-base shadow-overlay backdrop:bg-overlay-scrim"
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id={titleId} className="mb-1 text-[15px]/5 font-medium">
        {t("security.unreadable.title")}
      </h2>
      <p className="text-text-muted">{t(`security.unreadable.${state === "lost" ? "lost" : "locked"}`)}</p>
      <p className="text-text-muted">{t("security.unreadable.notes")}</p>
      {failed && (
        <p role="alert" className="text-state-fg-danger">
          {t("security.unreadable.failed")}
        </p>
      )}
      <div className="flex justify-end pt-2">
        <Button variant="submit" disabled={resetting} onClick={reset}>
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
