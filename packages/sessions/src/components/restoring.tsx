import { useTranslation } from "react-i18next";

// Загрузка при открытии окна, пока поднимаются открытые вкладки. Цвет
// боковой панели, как у окна до загрузки страницы.
export function Restoring() {
  const { t } = useTranslation("sessions");

  return (
    <output className="grid h-full place-items-center bg-bg-deep">
      <span className="flex items-center gap-2 text-[13px] text-text-muted">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-text-muted" />
        {t("restoring")}
      </span>
    </output>
  );
}
